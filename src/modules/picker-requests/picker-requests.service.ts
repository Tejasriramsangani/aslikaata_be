import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';
import {
  PickerRequest,
  PickerRequestDocument,
  PickerRequestStatus,
  VEHICLE_LABELS,
} from './schemas/picker-request.schema.js';
import { CreatePickerRequestDto, ListPickerRequestsQuery } from './dto/picker-request.dto.js';
import { User, UserDocument, UserRole, UserStatus } from '../identity/schemas/user.schema.js';
import {
  EmployeeProfile,
  EmployeeProfileDocument,
  EmployeeStatus,
} from '../employees/schemas/employee-profile.schema.js';
import { AuditLog, AuditLogDocument } from '../../common/audit/audit-log.schema.js';
import {
  AdminCredential,
  AdminCredentialDocument,
} from '../identity/schemas/admin-credential.schema.js';
import { SequenceService } from '../../common/database/sequence.service.js';
import { SMS_SERVICE } from '../identity/sms/sms.interface.js';
import type { ISmsService } from '../identity/sms/sms.interface.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schemas/notification.schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mobileVariants = (m: string) => [m, `+91${m}`];

/** Max applications accepted per IP per hour (the endpoint is public). */
const MAX_SUBMISSIONS_PER_IP_PER_HOUR = 5;

@Injectable()
export class PickerRequestsService {
  private readonly logger = new Logger(PickerRequestsService.name);
  private readonly ipHits = new Map<string, number[]>();

  constructor(
    @InjectModel(PickerRequest.name) private readonly requestModel: Model<PickerRequestDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(EmployeeProfile.name) private readonly profileModel: Model<EmployeeProfileDocument>,
    @InjectModel(AuditLog.name) private readonly auditLogModel: Model<AuditLogDocument>,
    @InjectModel(AdminCredential.name) private readonly adminModel: Model<AdminCredentialDocument>,
    private readonly sequenceService: SequenceService,
    private readonly notifications: NotificationsService,
    private readonly realtimeGateway: RealtimeGateway,
    @Inject(SMS_SERVICE) private readonly smsService: ISmsService,
  ) {}

  private checkRateLimit(ip?: string) {
    if (!ip) return;
    const now = Date.now();
    const hits = (this.ipHits.get(ip) || []).filter((t) => now - t < 3600_000);
    if (hits.length >= MAX_SUBMISSIONS_PER_IP_PER_HOUR) {
      throw new HttpException(
        'Too many requests from this device. Please try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    hits.push(now);
    this.ipHits.set(ip, hits);
  }

  // ---------------------------------------------------------------- public

  async submit(dto: CreatePickerRequestDto, ip?: string) {
    this.checkRateLimit(ip);

    const existingUser = await this.userModel.findOne({ mobile: { $in: mobileVariants(dto.mobile) } });
    if (existingUser?.roles.includes(UserRole.EMPLOYEE)) {
      throw new ConflictException({
        message: 'This number already has an ASLI KAATA field account. Please log in instead.',
        details: { code: 'ACCOUNT_EXISTS' },
      });
    }

    const pending = await this.requestModel.findOne({
      mobile: dto.mobile,
      status: PickerRequestStatus.PENDING,
    });
    if (pending) {
      throw new ConflictException({
        message: `Your request ${pending.requestCode} is already under review. We will get back to you soon.`,
        details: { code: 'REQUEST_PENDING', requestCode: pending.requestCode },
      });
    }

    const requestCode = `PR-${await this.sequenceService.getNextSequence('pickerRequest', 10000)}`;
    const created = await this.requestModel.create({
      requestCode,
      fullName: dto.fullName.trim(),
      mobile: dto.mobile,
      alternateMobile: dto.alternateMobile || null,
      email: dto.email ? dto.email.toLowerCase().trim() : null,
      address: {
        line1: dto.address.line1.trim(),
        area: dto.address.area.trim(),
        landmark: dto.address.landmark?.trim() || null,
        city: dto.address.city.trim(),
        district: dto.address.district?.trim() || null,
        state: dto.address.state?.trim() || 'Andhra Pradesh',
        pincode: dto.address.pincode,
      },
      workType: dto.workType,
      vehicleType: dto.vehicleType,
      vehicleNumber: dto.vehicleNumber?.trim().toUpperCase() || null,
      experienceYears: dto.experienceYears ?? 0,
      availability: dto.availability,
      about: dto.about?.trim() || null,
    });

    // Live badge / toast for the admin panel.
    this.realtimeGateway.emitToAdminQueue('picker_request.created', {
      id: created._id.toString(),
      requestCode,
      fullName: created.fullName,
      city: created.address.city,
    });

    return {
      requestCode,
      status: created.status,
      message: 'Request received. Our team will review it and get back to you.',
    };
  }

  /** Minimal, mobile-keyed status so an applicant can check back from the login screen. */
  async getStatus(mobile: string) {
    const latest = await this.requestModel.findOne({ mobile }).sort({ createdAt: -1 });
    if (!latest) return { found: false };
    return {
      found: true,
      requestCode: latest.requestCode,
      status: latest.status,
      submittedAt: (latest as any).createdAt as Date,
      reviewedAt: latest.reviewedAt ?? null,
      rejectionReason: latest.status === PickerRequestStatus.REJECTED ? latest.rejectionReason : null,
    };
  }

  // ----------------------------------------------------------------- admin

  private toView(r: PickerRequestDocument) {
    return {
      id: r._id.toString(),
      requestCode: r.requestCode,
      fullName: r.fullName,
      mobile: r.mobile,
      alternateMobile: r.alternateMobile ?? null,
      email: r.email ?? null,
      address: r.address,
      workType: r.workType,
      vehicleType: r.vehicleType,
      vehicleLabel: VEHICLE_LABELS[r.vehicleType] ?? r.vehicleType,
      vehicleNumber: r.vehicleNumber ?? null,
      experienceYears: r.experienceYears,
      availability: r.availability,
      about: r.about ?? null,
      status: r.status,
      reviewedByName: r.reviewedByName ?? null,
      reviewedAt: r.reviewedAt ?? null,
      rejectionReason: r.rejectionReason ?? null,
      employeeCode: r.employeeCode ?? null,
      createdAt: (r as any).createdAt as Date,
    };
  }

  async list(query: ListPickerRequestsQuery) {
    const filter: Record<string, any> = {};
    if (query.status) filter.status = query.status;
    if (query.search?.trim()) {
      const rx = new RegExp(escapeRegex(query.search.trim()), 'i');
      filter.$or = [
        { fullName: rx },
        { mobile: rx },
        { requestCode: rx },
        { 'address.city': rx },
        { 'address.area': rx },
        { 'address.pincode': rx },
      ];
    }
    const [items, grouped] = await Promise.all([
      this.requestModel.find(filter).sort({ createdAt: -1 }).limit(300),
      this.requestModel.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
    for (const g of grouped) counts[g._id] = g.n;
    return { items: items.map((r) => this.toView(r)), counts };
  }

  async pendingCount() {
    return { pending: await this.requestModel.countDocuments({ status: PickerRequestStatus.PENDING }) };
  }

  private async load(id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException('Request not found');
    const r = await this.requestModel.findById(id);
    if (!r) throw new NotFoundException('Request not found');
    return r;
  }

  private async adminName(userId: string): Promise<string | null> {
    const cred = await this.adminModel.findOne({ userId }).select('name').lean();
    return cred?.name || null;
  }

  async approve(id: string, admin: { userId: string }) {
    const request = await this.load(id);
    if (request.status !== PickerRequestStatus.PENDING) {
      throw new BadRequestException(`This request is already ${request.status.toLowerCase()}.`);
    }

    // 1) The login account: reuse the user if the number already exists (e.g. a customer).
    let user = await this.userModel.findOne({ mobile: { $in: mobileVariants(request.mobile) } });
    if (user && user.status !== UserStatus.ACTIVE) {
      throw new BadRequestException('The account for this mobile number is not active, so it cannot be approved.');
    }
    if (!user) {
      user = await this.userModel.create({
        mobile: request.mobile,
        roles: [UserRole.EMPLOYEE],
        status: UserStatus.ACTIVE,
      });
    } else if (!user.roles.includes(UserRole.EMPLOYEE)) {
      user.roles.push(UserRole.EMPLOYEE);
      await user.save();
    }

    // 2) The employee profile (what pickups are assigned to).
    const userId = user._id.toString();
    let profile = await this.profileModel.findOne({ userId });
    if (profile && profile.status === EmployeeStatus.SUSPENDED) {
      throw new BadRequestException('This person has a suspended field account. Reinstate it from Workforce instead.');
    }
    if (!profile) {
      profile = await this.profileModel.create({
        userId,
        employeeCode: await this.sequenceService.generateEmployeeCode(
          async (code) => !!(await this.profileModel.exists({ employeeCode: code })),
        ),
        fullName: request.fullName,
        status: EmployeeStatus.APPROVED,
        vehicleType: VEHICLE_LABELS[request.vehicleType],
        vehicleNumber: request.vehicleNumber || null,
        approvedAt: new Date(),
        approvedBy: admin.userId,
        address: request.address,
        pickerRequestId: request._id.toString(),
      });
    } else if (profile.status !== EmployeeStatus.APPROVED) {
      profile.status = EmployeeStatus.APPROVED;
      profile.approvedAt = new Date();
      profile.approvedBy = admin.userId;
      await profile.save();
    }

    // 3) Close the request.
    request.status = PickerRequestStatus.APPROVED;
    request.reviewedBy = admin.userId;
    request.reviewedByName = await this.adminName(admin.userId);
    request.reviewedAt = new Date();
    request.rejectionReason = null;
    request.userId = userId;
    request.employeeProfileId = profile._id.toString();
    request.employeeCode = profile.employeeCode;
    await request.save();

    await this.auditLogModel.create({
      actorId: admin.userId,
      actorRole: 'ADMIN',
      action: 'APPROVE_PICKER_REQUEST',
      resource: 'pickerrequests',
      resourceId: request._id.toString(),
      metadata: { requestCode: request.requestCode, employeeCode: profile.employeeCode, mobile: request.mobile },
    });

    // 4) Tell the applicant: in-app (waiting in their inbox for first login) + SMS.
    const title = 'Welcome to ASLI KAATA! 🎉';
    const body = `Our team approved your request — you can now be a part of ASLI KAATA. Your employee ID is ${profile.employeeCode}. New pickups assigned to you will appear on the Home tab.`;
    await this.notifications.notify({
      userId,
      type: NotificationType.ACCOUNT_APPROVED,
      title,
      body,
      data: { requestCode: request.requestCode, employeeCode: profile.employeeCode },
    });
    this.smsService
      .sendText(
        request.mobile,
        `ASLI KAATA: Your picker request is approved! Employee ID: ${profile.employeeCode}. Log in to the Field Ops app with this mobile number.`,
        { key: 'PICKER_APPROVED', variables: [profile.employeeCode] },
      )
      .catch((err) => this.logger.warn(`Approval SMS failed for ${request.requestCode}: ${err.message}`));

    this.realtimeGateway.emitToAdminQueue('picker_request.updated', { id, status: request.status });
    return this.toView(request);
  }

  async reject(id: string, reason: string, admin: { userId: string }) {
    const request = await this.load(id);
    if (request.status !== PickerRequestStatus.PENDING) {
      throw new BadRequestException(`This request is already ${request.status.toLowerCase()}.`);
    }
    request.status = PickerRequestStatus.REJECTED;
    request.reviewedBy = admin.userId;
    request.reviewedByName = await this.adminName(admin.userId);
    request.reviewedAt = new Date();
    request.rejectionReason = reason.trim();
    await request.save();

    await this.auditLogModel.create({
      actorId: admin.userId,
      actorRole: 'ADMIN',
      action: 'REJECT_PICKER_REQUEST',
      resource: 'pickerrequests',
      resourceId: request._id.toString(),
      metadata: { requestCode: request.requestCode, reason: request.rejectionReason },
    });

    this.smsService
      .sendText(
        request.mobile,
        `ASLI KAATA: Picker request ${request.requestCode} not approved. You can apply again later. Reason: ${request.rejectionReason}`,
        { key: 'PICKER_REJECTED', variables: [request.requestCode, request.rejectionReason] },
      )
      .catch((err) => this.logger.warn(`Rejection SMS failed for ${request.requestCode}: ${err.message}`));

    this.realtimeGateway.emitToAdminQueue('picker_request.updated', { id, status: request.status });
    return this.toView(request);
  }
}
