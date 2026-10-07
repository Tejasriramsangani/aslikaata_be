import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Interval } from '@nestjs/schedule';
import { Model, type ClientSession } from 'mongoose';
import { OutboxEvent, OutboxEventDocument, OutboxStatus } from '../../common/outbox/outbox-event.schema.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private isProcessing = false;

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
    private readonly realtimeGateway: RealtimeGateway,
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
      .find({ status: OutboxStatus.PENDING })
      .sort({ occurredAt: 1 })
      .limit(50);

    let processedCount = 0;
    let failedCount = 0;

    for (const event of pendingEvents) {
      try {
        event.status = OutboxStatus.PROCESSING;
        await event.save();

        await this.dispatchEvent(event.eventType, event.payload);

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
  private async dispatchEvent(eventType: string, payload: Record<string, any>) {
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
        break;

      case 'summary.ready':
        if (payload.customerId) {
          this.realtimeGateway.emitToUser(payload.customerId, 'summary.ready', payload);
        }
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, 'summary.ready', payload);
        }
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
        break;

      default:
        this.logger.log(`Default event dispatch: ${eventType}`);
        if (payload.pickupId) {
          this.realtimeGateway.emitToPickup(payload.pickupId, eventType, payload);
        }
    }
  }

  async listEvents(status?: OutboxStatus, limit: number = 50) {
    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    return this.outboxModel.find(filter).sort({ occurredAt: -1 }).limit(limit);
  }
}
