import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
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
import {
  CreateEmployeeProfileDto,
  UploadEmployeeDocumentDto,
  ReviewDocumentDto,
  ReviewEmployeeStatusDto,
} from './dto/employee.dto.js';
import { SequenceService } from '../../common/database/sequence.service.js';
import { CryptoUtil } from '../../common/utils/crypto.util.js';
import { AuditLog, AuditLogDocument } from '../../common/audit/audit-log.schema.js';

@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(
    @InjectModel(EmployeeProfile.name)
    private readonly profileModel: Model<EmployeeProfileDocument>,
    @InjectModel(EmployeeDocument.name)
    private readonly documentModel: Model<EmployeeDocumentDocument>,
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
    private readonly sequenceService: SequenceService,
  ) {}

  /**
   * Creates or updates the employee profile.
   */
  async createOrUpdateProfile(
    userId: string,
    dto: CreateEmployeeProfileDto,
  ): Promise<EmployeeProfileDocument> {
    let profile = await this.profileModel.findOne({ userId });

    if (!profile) {
      const employeeCode = await this.sequenceService.generateEmployeeCode();
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
