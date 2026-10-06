import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../../common/audit/audit-log.schema.js';

export interface AuditQueryOptions {
  actorId?: string;
  action?: string;
  resource?: string;
  resourceId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Appends an immutable audit log record.
   */
  async recordLog(data: {
    actorId?: string | null;
    actorRole: string;
    action: string;
    resource: string;
    resourceId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, any>;
  }): Promise<AuditLogDocument> {
    return this.auditLogModel.create({
      actorId: data.actorId || null,
      actorRole: data.actorRole,
      action: data.action,
      resource: data.resource,
      resourceId: data.resourceId || null,
      ipAddress: data.ipAddress || null,
      userAgent: data.userAgent || null,
      metadata: data.metadata || {},
    });
  }

  /**
   * Task 7.2.1: Query audit trail with filters for Admin Portal.
   */
  async queryLogs(options: AuditQueryOptions = {}) {
    const filter: Record<string, any> = {};

    if (options.actorId) filter.actorId = options.actorId;
    if (options.action) filter.action = options.action;
    if (options.resource) filter.resource = options.resource;
    if (options.resourceId) filter.resourceId = options.resourceId;

    if (options.startDate || options.endDate) {
      filter.createdAt = {};
      if (options.startDate) filter.createdAt.$gte = new Date(options.startDate);
      if (options.endDate) filter.createdAt.$lte = new Date(options.endDate);
    }

    const page = Math.max(1, options.page || 1);
    const limit = Math.min(100, options.limit || 50);
    const skip = (page - 1) * limit;

    const [total, logs] = await Promise.all([
      this.auditLogModel.countDocuments(filter),
      this.auditLogModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      logs,
    };
  }
}
