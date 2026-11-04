import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  EmployeeProfile,
  EmployeeProfileDocument,
  EmployeeStatus,
} from './schemas/employee-profile.schema.js';
import {
  EmployeeDocument,
  EmployeeDocumentDocument,
  DocType,
  DocumentStatus,
} from './schemas/employee-document.schema.js';
import { User, UserDocument, UserRole, UserStatus } from '../identity/schemas/user.schema.js';
import {
  CreateEmployeeProfileDto,
  UploadEmployeeDocumentDto,
  ReviewDocumentDto,
  ReviewEmployeeStatusDto,
} from './dto/employee.dto.js';
import { SequenceService } from '../../common/database/sequence.service.js';
import { Pickup, PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../pickups/schemas/pickup-status.enum.js';
import { Session, SessionDocument } from '../identity/schemas/session.schema.js';
import { maxPickupsPerEmployeePerDay } from '../../common/utils/capacity.util.js';

/** Pickups still open with their employee: assigned and not yet finished or closed. */
const OPEN_PICKUP_STATUSES = [
  PickupStatus.ASSIGNED,
  PickupStatus.ON_THE_WAY,
  PickupStatus.ARRIVED,
  PickupStatus.VERIFIED,
  PickupStatus.IN_PROGRESS,
  PickupStatus.MEASURED,
  PickupStatus.SUMMARY_READY,
  PickupStatus.CUSTOMER_CONFIRMED,
  PickupStatus.PAYMENT_PENDING,
  PickupStatus.SETTLED,
  PickupStatus.OTP_VERIFIED,
  PickupStatus.INVOICED,
];
/** Pickups that take up an employee's day: everything assigned to them except cancelled / failed ones. */
const DAY_LOAD_STATUSES = [...OPEN_PICKUP_STATUSES, PickupStatus.COMPLETED];
const FINISHED_PICKUP_STATUSES = new Set<string>([
  PickupStatus.COMPLETED,
  PickupStatus.INVOICED,
  PickupStatus.OTP_VERIFIED,
  PickupStatus.SETTLED,
]);
const BUSINESS_TIMEZONE = 'Asia/Kolkata';
import { CryptoUtil } from '../../common/utils/crypto.util.js';
import { AuditLog, AuditLogDocument } from '../../common/audit/audit-log.schema.js';
import { OutboxService } from '../outbox/outbox.service.js';

@Injectable()
export class EmployeesService implements OnModuleInit {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    @InjectModel(EmployeeProfile.name)
    private readonly profileModel: Model<EmployeeProfileDocument>,
    @InjectModel(EmployeeDocument.name)
    private readonly documentModel: Model<EmployeeDocumentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly sequenceService: SequenceService,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional() @InjectModel(Pickup.name) private readonly pickupModel?: Model<PickupDocument>,
    @Optional() @InjectModel(Session.name) private readonly sessionModel?: Model<SessionDocument>,
  ) {}

  async onModuleInit() {
    // Demo employees are opt-in (SEED_DEMO_DATA=true in .env). Normally employees come from the
    // database: approved picker requests and the admin Workforce screen.
    if (process.env.SEED_DEMO_DATA !== 'true') return;
    try {
      const demoEmployees = [
        {
          mobile: '9848011111',
          code: 'EMP-001',
          fullName: 'Ramesh Kumar',
          vehicleType: 'Tata Ace Gold (Diesel)',
          vehicleNumber: 'AP 16 TX 4920',
        },
        {
          mobile: '9848022222',
          code: 'EMP-002',
          fullName: 'Suresh Babu',
          vehicleType: 'Electric 3-Wheeler Cargo',
          vehicleNumber: 'AP 16 EV 0482',
        },
      ];

      for (const d of demoEmployees) {
        let user = await this.userModel.findOne({
          mobile: { $in: [d.mobile, `+91${d.mobile}`] },
        });
        if (!user) {
          user = await this.userModel.create({
            mobile: d.mobile,
            roles: [UserRole.EMPLOYEE],
            status: UserStatus.ACTIVE,
            lastLoginAt: new Date(),
          });
        }

        const existingProfile = await this.profileModel.findOne({ userId: user._id.toString() });
        if (!existingProfile) {
          await this.profileModel.create({
            userId: user._id.toString(),
            employeeCode: d.code,
            fullName: d.fullName,
            status: EmployeeStatus.APPROVED,
            vehicleType: d.vehicleType,
            vehicleNumber: d.vehicleNumber,
            approvedAt: new Date(),
          });
          this.logger.log(`Default employee profile seeded: ${d.fullName} (${d.mobile})`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Employee auto-seed deferred: ${err.message}`);
    }
  }

  /**
   * Creates or updates the employee profile.
   */
  async createOrUpdateProfile(
    userId: string,
    dto: CreateEmployeeProfileDto,
  ): Promise<EmployeeProfileDocument> {
    let profile = await this.profileModel.findOne({ userId });

    if (!profile) {
      const employeeCode = await this.sequenceService.generateEmployeeCode(
        async (code) => !!(await this.profileModel.exists({ employeeCode: code })),
      );
      profile = await this.profileModel.create({
        userId,
        employeeCode,
        fullName: dto.fullName,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        gender: dto.gender || null,
        vehicleType: dto.vehicleType || null,
        vehicleNumber: dto.vehicleNumber || null,
        status: EmployeeStatus.ONBOARDING,
      });
    } else {
      profile.fullName = dto.fullName;
      if (dto.dateOfBirth) profile.dateOfBirth = new Date(dto.dateOfBirth);
      if (dto.gender) profile.gender = dto.gender;
      if (dto.vehicleType) profile.vehicleType = dto.vehicleType;
      if (dto.vehicleNumber) profile.vehicleNumber = dto.vehicleNumber;
      await profile.save();
    }

    return profile;
  }

  async getProfile(userId: string): Promise<EmployeeProfileDocument> {
    const profile = await this.profileModel.findOne({ userId });
    if (!profile) {
      throw new NotFoundException('Employee profile not found');
    }
    return profile;
  }

  /**
   * The signed-in employee's own profile for the app: stored profile + phone number + work stats,
   * all read from the database.
   */
  async getMyProfile(userId: string) {
    const profile = await this.getProfile(userId);
    const [user, pickups] = await Promise.all([
      this.userModel.findById(userId).select('mobile'),
      this.pickupModel
        ? this.pickupModel
            .find({ 'assignment.employeeProfileId': String(profile._id) })
            .select('status totals scheduledDate')
            .lean()
        : Promise.resolve([] as any[]),
    ]);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: BUSINESS_TIMEZONE });
    let completed = 0;
    let openJobs = 0;
    let todayJobs = 0;
    let netGrams = 0;
    let payoutPaise = 0;
    for (const p of pickups as any[]) {
      if (FINISHED_PICKUP_STATUSES.has(p.status)) {
        // Customer has been paid: the collection is done even if the paperwork is still closing.
        completed++;
        netGrams += Number(p.totals?.netWeightGrams || 0);
        payoutPaise += Number(p.totals?.totalAmount || 0);
      } else if (OPEN_PICKUP_STATUSES.includes(p.status)) {
        openJobs++;
      }
      if (p.scheduledDate === today && p.status !== PickupStatus.CANCELLED && p.status !== PickupStatus.FAILED) {
        todayJobs++;
      }
    }

    return {
      ...profile.toObject(),
      mobile: user?.mobile ?? null,
      stats: {
        totalAssigned: pickups.length,
        completed,
        openJobs,
        todayJobs,
        totalWeightKg: Number((netGrams / 1000).toFixed(2)),
        totalPayoutRupees: Number((payoutPaise / 100).toFixed(2)),
      },
    };
  }

  /** Switches the employee's duty on or off (the Duty button in the app header). */
  async setDuty(userId: string, onDuty: boolean): Promise<{ onDuty: boolean; dutyChangedAt: Date }> {
    const profile = await this.getProfile(userId);
    if (onDuty && profile.status !== EmployeeStatus.APPROVED) {
      throw new BadRequestException('Your account must be approved before you can go on duty.');
    }
    profile.onDuty = onDuty;
    profile.dutyChangedAt = new Date();
    await profile.save();
    return { onDuty: profile.onDuty, dutyChangedAt: profile.dutyChangedAt };
  }

  /**
   * Uploads an employee document with AES-256 encrypted identifier & masked string.
   */
  async uploadDocument(
    userId: string,
    dto: UploadEmployeeDocumentDto,
  ): Promise<EmployeeDocumentDocument> {
    const profile = await this.getProfile(userId);

    const identifierEnc = CryptoUtil.encryptAes256(dto.rawIdentifier);
    const identifierMasked = CryptoUtil.maskIdentifier(dto.rawIdentifier);

    // Close any previous active version of this docType
    await this.documentModel.updateMany(
      { employeeProfileId: profile._id.toString(), docType: dto.docType, isCurrent: true },
      { isCurrent: false },
    );

    const doc = await this.documentModel.create({
      employeeProfileId: profile._id.toString(),
      docType: dto.docType,
      identifierEnc,
      identifierMasked,
      fileUrl: dto.fileUrl,
      isCurrent: true,
      status: DocumentStatus.PENDING,
      expiresOn: dto.expiresOn ? new Date(dto.expiresOn) : null,
    });

    if (profile.status === EmployeeStatus.ONBOARDING) {
      profile.status = EmployeeStatus.PENDING_REVIEW;
      await profile.save();
    }

    return doc;
  }

  /**
   * Lists employee's own uploaded documents.
   */
  async getMyDocuments(userId: string): Promise<EmployeeDocumentDocument[]> {
    const profile = await this.getProfile(userId);
    return this.documentModel.find({
      employeeProfileId: profile._id.toString(),
      isCurrent: true,
    });
  }

  // --- Admin Operations ---

  async listPendingKyc(): Promise<EmployeeProfileDocument[]> {
    return this.profileModel.find({
      status: { $in: [EmployeeStatus.PENDING_REVIEW, EmployeeStatus.ONBOARDING] },
    });
  }

  /**
   * Employees for the admin screens, with live availability data:
   *  - isLoggedIn: has an active (not logged-out, not expired) session in the app
   *  - activeJobs: pickups still open with them
   *  - jobsByDate: pickups already given to them per scheduled day ("YYYY-MM-DD" -> count)
   *  - dailyLimit: pickups one employee can take in a day
   * An employee is free for an order when logged in AND has fewer than dailyLimit jobs on the
   * order's date. A busy day does not make them busy on other days.
   */
  async listAllEmployees(status?: string): Promise<any[]> {
    const query: any = status ? { status: status as EmployeeStatus } : {};
    const profiles = await this.profileModel.find(query).sort({ createdAt: -1 });
    if (profiles.length === 0) return [];

    const userIds = profiles.map((p) => String(p.userId));
    const profileIds = profiles.map((p) => String(p._id));
    const [users, loggedInIds, openPickups, dayLoadPickups] = await Promise.all([
      this.userModel.find({ _id: { $in: userIds } }).select('mobile lastLoginAt'),
      this.sessionModel
        ? this.sessionModel.distinct('userId', {
            userId: { $in: userIds },
            revokedAt: null,
            expiresAt: { $gt: new Date() },
          })
        : Promise.resolve([] as any[]),
      this.pickupModel
        ? this.pickupModel
            .find({ 'assignment.employeeProfileId': { $in: profileIds }, status: { $in: OPEN_PICKUP_STATUSES } })
            .select('assignment.employeeProfileId')
            .lean()
        : Promise.resolve([] as any[]),
      this.pickupModel
        ? this.pickupModel
            .find({ 'assignment.employeeProfileId': { $in: profileIds }, status: { $in: DAY_LOAD_STATUSES } })
            .select('assignment.employeeProfileId scheduledDate')
            .lean()
        : Promise.resolve([] as any[]),
    ]);

    const userById = new Map(users.map((u) => [String(u._id), u]));
    const loggedIn = new Set((loggedInIds as any[]).map(String));
    const jobsByProfile = new Map<string, number>();
    for (const p of openPickups as any[]) {
      const id = String(p.assignment?.employeeProfileId);
      jobsByProfile.set(id, (jobsByProfile.get(id) || 0) + 1);
    }

    const jobsByDateByProfile = new Map<string, Record<string, number>>();
    for (const p of dayLoadPickups as any[]) {
      const id = String(p.assignment?.employeeProfileId);
      const date = String(p.scheduledDate || '');
      if (!date) continue;
      const days = jobsByDateByProfile.get(id) ?? {};
      days[date] = (days[date] || 0) + 1;
      jobsByDateByProfile.set(id, days);
    }
    const dailyLimit = maxPickupsPerEmployeePerDay();

    return profiles.map((p) => {
      const user = userById.get(String(p.userId));
      return {
        ...p.toObject(),
        mobile: user?.mobile ?? null,
        lastLoginAt: user?.lastLoginAt ?? null,
        isLoggedIn: loggedIn.has(String(p.userId)),
        onDuty: Boolean((p as any).onDuty),
        activeJobs: jobsByProfile.get(String(p._id)) || 0,
        jobsByDate: jobsByDateByProfile.get(String(p._id)) ?? {},
        dailyLimit,
      };
    });
  }

  /**
   * Admin document review with mandatory audit logging.
   */
  async getEmployeeDocumentsForAdmin(
    profileId: string,
    adminUserId: string,
    ipAddress?: string,
  ): Promise<EmployeeDocumentDocument[]> {
    // Audit log this sensitive document inspection
    await this.auditLogModel.create({
      actorId: adminUserId,
      actorRole: 'ADMIN',
      action: 'VIEW_KYC_DOCUMENTS',
      resource: 'employeeprofiles',
      resourceId: profileId,
      ipAddress: ipAddress || null,
      metadata: { timestamp: new Date() },
    });

    return this.documentModel.find({ employeeProfileId: profileId, isCurrent: true });
  }

  async reviewDocument(
    docId: string,
    adminUserId: string,
    dto: ReviewDocumentDto,
  ): Promise<EmployeeDocumentDocument> {
    const doc = await this.documentModel.findById(docId);
    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    doc.status = dto.status;
    doc.rejectionReason = dto.rejectionReason || null;
    doc.reviewedBy = adminUserId;
    doc.reviewedAt = new Date();
    await doc.save();

    if (dto.status === DocumentStatus.REJECTED && this.outboxService) {
      const profile = await this.profileModel.findById(doc.employeeProfileId);
      await this.outboxService.createEvent('employee.document_rejected', {
        employeeProfileId: doc.employeeProfileId,
        employeeUserId: profile?.userId,
        docType: doc.docType,
        rejectionReason: doc.rejectionReason,
      });
    }

    return doc;
  }

  /**
   * Admin approves an employee.
   * Enforces Rule 5.8: requires all required documents verified and not expired.
   */
  async approveEmployee(
    profileId: string,
    adminUserId: string,
  ): Promise<EmployeeProfileDocument> {
    const profile = await this.profileModel.findById(profileId);
    if (!profile) {
      throw new NotFoundException('Employee profile not found');
    }

    const docs = await this.documentModel.find({
      employeeProfileId: profileId,
      isCurrent: true,
    });

    const verifiedDocs = docs.filter((d) => d.status === DocumentStatus.VERIFIED);
    const hasAadhaar = verifiedDocs.some((d) => d.docType === DocType.AADHAAR);
    const hasLicense = verifiedDocs.some((d) => d.docType === DocType.DRIVING_LICENSE);
    const hasRC = verifiedDocs.some((d) => d.docType === DocType.VEHICLE_RC);

    if (!hasAadhaar || !hasLicense || !hasRC) {
      throw new BadRequestException(
        'Cannot approve employee: Aadhaar, Driving License, and Vehicle RC must all be verified.',
      );
    }

    const now = new Date();
    const hasExpired = verifiedDocs.some((d) => d.expiresOn && d.expiresOn < now);
    if (hasExpired) {
      throw new BadRequestException('Cannot approve employee: one or more required documents have expired.');
    }

    profile.status = EmployeeStatus.APPROVED;
    profile.approvedAt = now;
    profile.approvedBy = adminUserId;
    profile.suspendedReason = undefined;
    await profile.save();

    if (this.outboxService) {
      await this.outboxService.createEvent('employee.approved', {
        employeeProfileId: profile._id.toString(),
        employeeUserId: profile.userId,
        employeeCode: profile.employeeCode,
        fullName: profile.fullName,
      });
    }

    return profile;
  }

  async setEmployeeStatus(
    profileId: string,
    adminUserId: string,
    dto: ReviewEmployeeStatusDto,
  ): Promise<EmployeeProfileDocument> {
    const profile = await this.profileModel.findById(profileId);
    if (!profile) {
      throw new NotFoundException('Employee profile not found');
    }

    profile.status = dto.status;
    if (dto.status === EmployeeStatus.SUSPENDED) {
      profile.suspendedReason = dto.reason || 'Suspended by admin';
    }
    await profile.save();

    return profile;
  }
}
