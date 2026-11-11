import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { Model, Types, isValidObjectId } from 'mongoose';
import { OutboxEvent, OutboxEventDocument, OutboxStatus } from '../../common/outbox/outbox-event.schema.js';
import { Pickup, PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { User, UserDocument } from '../identity/schemas/user.schema.js';
import { CustomerProfile, CustomerProfileDocument } from '../customers/schemas/customer-profile.schema.js';
import { Settlement, SettlementDocument, SettlementStatus } from '../settlements/schemas/settlement.schema.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';
import { SMS_SERVICE } from '../identity/sms/sms.interface.js';
import type { ISmsService, WhatsAppDeliveryResult } from '../identity/sms/sms.interface.js';
import { whatsappKeysForEvent, whatsappVariables } from './whatsapp-notification-plan.js';
import { whatsappSetupReport } from './whatsapp-setup.js';
import type { CustomerWhatsappKey } from './whatsapp-notification-plan.js';

export const WHATSAPP_JOB = 'whatsapp.notification';
/** Uses the existing outbox collection and its _id uniqueness; no schema/index migration. */
@Injectable()
export class WhatsappNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(WhatsappNotificationsService.name);
  constructor(
    @InjectModel(OutboxEvent.name) private readonly jobs: Model<OutboxEventDocument>,
    @InjectModel(Pickup.name) private readonly pickups: Model<PickupDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(CustomerProfile.name) private readonly profiles: Model<CustomerProfileDocument>,
    @InjectModel(Settlement.name) private readonly settlements: Model<SettlementDocument>,
    private readonly config: ConfigService,
    @Inject(SMS_SERVICE) private readonly sms: ISmsService,
  ) {}

  /** Says at startup what is set up for WhatsApp and what is missing, so nothing silently fails to send. */
  onModuleInit(): void {
    const report = whatsappSetupReport((key) => this.config.get<string>(key));
    if (!report.channelOn) return; // SMS / mock mode: nothing WhatsApp-related to report
    const state = [
      `login OTP ${report.otpReady ? 'ready' : 'NOT ready'}`,
      `customer updates ${report.customerUpdatesOn ? 'ON' : 'OFF'}`,
    ].join(', ');
    if (report.missing.length === 0) this.logger.log(`WhatsApp: ${state}. All templates configured.`);
    else this.logger.warn(`WhatsApp: ${state}. Not set in .env: ${report.missing.join(', ')}`);
  }

  private enabled(): boolean {
    // Customer updates need their own explicit opt-in: the flag, a cut-over date AND a dedicated WhatsApp key
    // (FAST2SMS_WA_API_KEY). Login OTPs do not, so they keep working while these are being set up.
    return this.config.get('FAST2SMS_WA_NOTIFICATIONS_ENABLED') === 'true' &&
      this.config.get('SMS_PROVIDER') === 'fast2sms' && this.config.get('FAST2SMS_CHANNEL') === 'whatsapp' &&
      !!this.config.get<string>('FAST2SMS_WA_API_KEY')?.trim() &&
      Number.isFinite(Date.parse(this.config.get<string>('FAST2SMS_WA_NOTIFICATIONS_SINCE', '')));
  }

  /** Called only by the existing committed-event consumer. No provider call in business requests. */
  async handleDomainEvent(type: string, payload: Record<string, any>, occurredAt?: Date): Promise<void> {
    if (!this.enabled() || !occurredAt || new Date(occurredAt).getTime() < Date.parse(this.config.get('FAST2SMS_WA_NOTIFICATIONS_SINCE', '')) ||
        !isValidObjectId(payload.pickupId)) return;
    try {
      const keys = whatsappKeysForEvent(type, payload);
      if (!keys.length) return;
      const pickup = await this.pickups.findById(payload.pickupId);
      if (!pickup) return;
      for (const key of keys) {
        // Do not reserve the paid-notice key while collection/payment is still pending.
        // A later completion/settlement event must remain able to create that notice.
        if (key === 'PICKUP_COMPLETED_PAYMENT' && (pickup.status !== 'COMPLETED' ||
            !await this.settlements.findOne({ pickupId: String(pickup._id), status: SettlementStatus.COMPLETED }))) continue;
        if (key === 'PICKUP_CANCELLED' && pickup.status !== 'CANCELLED') continue;
        if (['PICKUP_REQUEST_RECEIVED', 'PICKUP_CONFIRMED', 'EMPLOYEE_ASSIGNED'].includes(key) &&
            ['CANCELLED', 'FAILED', 'COMPLETED'].includes(pickup.status)) continue;
        if (['PICKUP_CONFIRMED', 'EMPLOYEE_ASSIGNED'].includes(key) && !pickup.assignment) continue;
        // One confirmation/receipt/cancellation/payment per pickup; one assignment per actual assignment snapshot.
        const assignment = key === 'EMPLOYEE_ASSIGNED' ? `${pickup.assignment?.employeeProfileId}:${pickup.assignment?.assignedAt?.toISOString()}` : '';
        const id = new Types.ObjectId(createHash('sha256').update(`whatsapp:v1:${pickup._id}:${key}:${assignment}`).digest('hex').slice(0, 24));
        try {
          await this.jobs.create({ _id: id, eventType: WHATSAPP_JOB, status: OutboxStatus.PENDING, retryCount: 0,
            payload: { pickupId: String(pickup._id), key, assignment, delivery: { state: 'QUEUED' } } });
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
          // _id uniqueness deduplicates event/API retries and simultaneous worker instances.
        }
      }
    } catch {
      // The original outbox event can retry preparation; deterministic keys protect
      // messages already prepared. This runs after the business operation committed.
      this.logger.warn('WhatsApp job preparation failed; business operation remains committed.');
      throw new Error('WhatsApp job preparation failed');
    }
  }

  @Interval(5000)
  async processPending(): Promise<void> {
    if (!this.enabled()) return;
    const pending = await this.jobs.find({ eventType: WHATSAPP_JOB, status: OutboxStatus.PENDING }).sort({ occurredAt: 1 }).limit(25);
    for (const candidate of pending) await this.deliver(String(candidate._id));
  }

  async deliver(id: string): Promise<void> {
    if (!this.enabled()) return;
    // Atomic compare-and-set prevents concurrent workers from dispatching the same job twice.
    const job = await this.jobs.findOneAndUpdate({ _id: id, eventType: WHATSAPP_JOB, status: OutboxStatus.PENDING },
      { $set: { status: OutboxStatus.PROCESSING, 'payload.delivery.state': 'DISPATCHING' } }, { returnDocument: 'after' });
    if (!job) return;
    let result: WhatsAppDeliveryResult = { accepted: false, errorCode: 'VALIDATION' };
    try {
      const pickup = await this.pickups.findById(job.payload.pickupId);
      if (pickup) {
        const [user, profile, settlement] = await Promise.all([
          this.users.findById(pickup.customerId), this.profiles.findOne({ userId: pickup.customerId }),
          job.payload.key === 'PICKUP_COMPLETED_PAYMENT' ? this.settlements.findOne({ pickupId: String(pickup._id), status: SettlementStatus.COMPLETED }) : null,
        ]);
        const variables = whatsappVariables(job.payload.key as CustomerWhatsappKey, pickup, profile?.fullName || '', settlement);
        const assignment = `${pickup.assignment?.employeeProfileId}:${pickup.assignment?.assignedAt?.toISOString()}`;
        if (variables && user?.status === 'ACTIVE' && user.roles.includes(UserRole.CUSTOMER) &&
            (job.payload.key !== 'EMPLOYEE_ASSIGNED' || assignment === job.payload.assignment) && this.sms.sendTemplate) {
          result = await this.sms.sendTemplate(user.mobile, { key: job.payload.key, variables, correlationId: String(job._id) });
        }
      }
    } catch { result = { accepted: false, errorCode: 'NETWORK', ambiguous: true }; }
    // Never automatically retry: a timeout/crash can hide an accepted send. Operators review it first.
    await this.jobs.updateOne({ _id: job._id, status: OutboxStatus.PROCESSING }, { $set: {
      status: result.accepted ? OutboxStatus.PUBLISHED : OutboxStatus.FAILED,
      error: result.accepted ? null : result.errorCode || 'PROVIDER',
      'payload.delivery.state': result.accepted ? 'ACCEPTED' : result.ambiguous ? 'UNKNOWN' : 'REJECTED',
      ...(result.requestId ? { 'payload.delivery.requestId': result.requestId } : {}),
      'payload.delivery.httpStatus': result.httpStatus, 'payload.delivery.errorCode': result.errorCode,
    } });
  }

  async recordDelivery(requestId: string, status: string, correlationId?: string): Promise<void> {
    // Monotonic delivery states: an old sent/failed callback cannot overwrite delivered/read.
    const previous = status === 'sent' ? [null, 'sent'] : status === 'failed' ? [null, 'sent', 'failed'] :
      status === 'delivered' ? [null, 'sent', 'failed', 'delivered'] : [null, 'sent', 'failed', 'delivered', 'read'];
    const correlation = correlationId ? { _id: correlationId, $or: [
      { 'payload.delivery.requestId': { $exists: false } }, { 'payload.delivery.requestId': requestId },
    ] } : { 'payload.delivery.requestId': requestId };
    await this.jobs.updateOne({ eventType: WHATSAPP_JOB, ...correlation,
      'payload.delivery.providerStatus': { $in: previous } },
    { $set: { 'payload.delivery.providerStatus': status, 'payload.delivery.updatedAt': new Date(),
      'payload.delivery.requestId': requestId,
      ...(['delivered', 'read'].includes(status) ? { status: OutboxStatus.PUBLISHED, error: null, 'payload.delivery.state': 'ACCEPTED' } : {}),
      ...(status === 'failed' ? { status: OutboxStatus.FAILED, error: 'DELIVERY_FAILED', 'payload.delivery.state': 'REJECTED' } : {}),
    } });
  }
}
