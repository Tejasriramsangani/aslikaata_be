import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Model, type ClientSession } from 'mongoose';
import { OutboxEvent, OutboxEventDocument, OutboxStatus } from '../../common/outbox/outbox-event.schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { Pickup, PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../pickups/schemas/pickup-status.enum.js';
import { EmployeeProfile, EmployeeProfileDocument } from '../employees/schemas/employee-profile.schema.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/schemas/notification.schema.js';
import { planNotifications } from '../notifications/notification-templates.js';
import { WhatsappNotificationsService, WHATSAPP_JOB } from '../notifications/whatsapp-notifications.service.js';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private isProcessing = false;

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
    private readonly realtimeGateway: RealtimeGateway,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly whatsapp?: WhatsappNotificationsService,
  ) {}

  /**
   * Appends an event to the transactional outbox table.
   * Can run within an existing MongoDB transaction session for guaranteed atomicity.
   */
  async createEvent(
    eventType: string,
    payload: Record<string, any>,
    session?: ClientSession,
  ): Promise<OutboxEventDocument> {
    const [event] = await this.outboxModel.create(
      [
        {
          eventType,
          payload,
          status: OutboxStatus.PENDING,
          retryCount: 0,
        },
      ],
      { session },
    );
    return event;
  }

  /**
   * Task 6.3.1: Transactional Outbox Worker polling outboxevents.
   * Automatically executes every 5 seconds to process pending events.
   */
  @Interval(5000)
  async handleScheduledProcessing() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.processPendingEvents();
    } catch (err: any) {
      this.logger.error(`Scheduled outbox processing encountered an error: ${err.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Processes all pending outbox events and dispatches them to real-time socket rooms.
   */
  async processPendingEvents(): Promise<{ processed: number; failed: number }> {
    const pendingEvents = await this.outboxModel
      .find({ status: OutboxStatus.PENDING, eventType: { $ne: WHATSAPP_JOB } })
      .sort({ occurredAt: 1 })
      .limit(50);

    let processedCount = 0;
    let failedCount = 0;

    for (const event of pendingEvents) {
      try {
        event.status = OutboxStatus.PROCESSING;
        await event.save();

        await this.dispatchEvent(event.eventType, event.payload, (event as any).occurredAt);

        event.status = OutboxStatus.PUBLISHED;
        event.error = undefined;
        await event.save();
        processedCount++;
      } catch (err: any) {
        this.logger.error(`Error processing outbox event ${event._id}: ${err.message}`, err.stack);
        event.retryCount += 1;
        event.error = err.message || 'Unknown processing error';

        // Exponential backoff retry limit (5 retries max)
        if (event.retryCount >= 5) {
          event.status = OutboxStatus.FAILED;
        } else {
          event.status = OutboxStatus.PENDING;
        }
        await event.save();
        failedCount++;
      }
    }

    return { processed: processedCount, failed: failedCount };
  }

  /**
   * Dispatches domain event to designated real-time socket rooms per Section 8 / Task 6.2.1.
   */
  private async dispatchEvent(eventType: string, payload: Record<string, any>, occurredAt?: Date) {
    switch (eventType) {
      case 'pickup.requested':
        this.realtimeGateway.emitToAdminQueue('pickup.requested', payload);
        break;

      case 'pickup.assigned':
        if (payload.employeeUserId) {
          this.realtimeGateway.emitToEmployee(payload.employeeUserId, 'pickup.assigned', payload);
        }
        if (payload.customerId) {
          this.realtimeGateway.emitToUser(payload.customerId, 'pickup.assigned', payload);
        }
        this.realtimeGateway.emitToAdminDashboard('pickup.assigned', payload);
        break;

      case 'pickup.status_changed':
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, 'pickup.status_changed', payload);
        }
        this.realtimeGateway.emitToAdminDashboard('pickup.status_changed', payload);
        await this.notifyEmployeeOfPickupChange(payload);
        await this.sendPlannedNotifications(eventType, payload);
        break;

      case 'summary.ready':
        if (payload.customerId) {
          this.realtimeGateway.emitToUser(payload.customerId, 'summary.ready', payload);
        }
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, 'summary.ready', payload);
        }
        await this.sendPlannedNotifications(eventType, payload);
        break;

      case 'settlement.completed':
      case 'otp.verified':
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, eventType, payload);
        }
        break;

      case 'pickup.completed':
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, 'pickup.completed', payload);
        }
        this.realtimeGateway.emitToAdminDashboard('pickup.completed', payload);
        break;

      case 'employee.approved':
      case 'employee.document_rejected':
        if (payload.employeeUserId) {
          this.realtimeGateway.emitToEmployee(payload.employeeUserId, eventType, payload);
        }
        this.realtimeGateway.emitToAdminDashboard(eventType, payload);
        await this.sendPlannedNotifications(eventType, payload);
        break;

      default:
        this.logger.log(`Default event dispatch: ${eventType}`);
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, eventType, payload);
        }
    }
    // Best-effort preparation is separate from push/socket delivery and never sends in a business request.
    await this.whatsapp?.handleDomainEvent(eventType, payload, occurredAt);
  }

  /**
   * In-app notifications for the employee a pickup belongs to. Hooked on the single
   * 'pickup.status_changed' event so every path is covered: admin assign, bulk auto-assign
   * and weekly route runs. Failures are logged and never fail the outbox event.
   */
  private async notifyEmployeeOfPickupChange(payload: Record<string, any>) {
    try {
      const isAssigned = payload.toStatus === PickupStatus.ASSIGNED;
      const isRescheduled = payload.action === 'RESCHEDULED';
      const isCancelled = payload.toStatus === PickupStatus.CANCELLED;
      if (!payload.pickupId || (!isAssigned && !isRescheduled && !isCancelled)) return;

      const pickup = await this.pickupModel.findById(payload.pickupId);
      const profileId = pickup?.assignment?.employeeProfileId;
      if (!pickup || !profileId) return;
      // A reschedule only matters to the employee while the pickup is still assigned to them.
      if (isRescheduled && pickup.status !== PickupStatus.ASSIGNED) return;

      const profile = await this.employeeProfileModel.findById(profileId);
      if (!profile) return;

      const slot = pickup.timeSlotSnapshot?.displayLabel;
      const when = [pickup.scheduledDate, slot].filter(Boolean).join(', ');
      const where = [pickup.addressSnapshot?.line1, pickup.addressSnapshot?.city].filter(Boolean).join(', ');
      const data = { pickupId: pickup._id.toString(), pickupCode: pickup.pickupCode };

      if (isCancelled) {
        await this.notificationsService.notify({
          userId: profile.userId.toString(),
          type: NotificationType.PICKUP_CANCELLED,
          title: 'Pickup cancelled',
          body: `${pickup.pickupCode} (${when}) was cancelled. It has been removed from your route.`,
          data,
        });
      } else if (isRescheduled) {
        await this.notificationsService.notify({
          userId: profile.userId.toString(),
          type: NotificationType.PICKUP_RESCHEDULED,
          title: 'Pickup rescheduled',
          body: `${pickup.pickupCode} moved to ${when}.${where ? ` Address: ${where}.` : ''}`,
          data,
        });
      } else {
        await this.notificationsService.notify({
          userId: profile.userId.toString(),
          type: NotificationType.PICKUP_ASSIGNED,
          title: 'New pickup assigned',
          body: `${pickup.pickupCode} • ${when}${where ? ` • ${where}` : ''}`,
          data,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Could not notify employee for pickup ${payload.pickupId}: ${err.message}`);
    }
  }

  /**
   * Customer notifications (picker assigned / on the way / arrived, postponed, summary ready, ...) and
   * employee account notifications, as in-app inbox entries plus FCM push. Message wording lives in
   * notification-templates.ts. Hooked on 'pickup.status_changed' (not 'pickup.assigned') so every
   * assignment path is covered once. Failures are logged and never fail the outbox event.
   */
  private async sendPlannedNotifications(eventType: string, payload: Record<string, any>) {
    try {
      let employeeName: string | undefined;
      // The picker's name appears in the customer's "assigned / on the way / nearby" messages.
      if (
        eventType === 'pickup.status_changed' &&
        [PickupStatus.ASSIGNED, PickupStatus.ON_THE_WAY, PickupStatus.ARRIVED].includes(payload.toStatus) &&
        payload.customerId &&
        payload.pickupId
      ) {
        const pickup = await this.pickupModel.findById(payload.pickupId);
        employeeName = pickup?.assignment?.employeeName;
      }
      for (const n of planNotifications(eventType, payload, { employeeName })) {
        await this.notificationsService.notify(n);
      }
    } catch (err: any) {
      this.logger.warn(`Could not send notifications for ${eventType}: ${err.message}`);
    }
  }

  async listEvents(status?: OutboxStatus, limit: number = 50) {
    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    return this.outboxModel.find(filter).sort({ occurredAt: -1 }).limit(limit);
  }
}
