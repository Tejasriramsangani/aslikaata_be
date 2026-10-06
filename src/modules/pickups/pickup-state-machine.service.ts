import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Pickup, PickupDocument } from './schemas/pickup.schema.js';
import { PickupEvent, PickupEventDocument } from './schemas/pickup-event.schema.js';
import { PickupStatus } from './schemas/pickup-status.enum.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';
import { OutboxService } from '../outbox/outbox.service.js';

export interface TransitionContext {
  pickup: PickupDocument;
  toStatus: PickupStatus;
  actor: {
    userId?: string | null;
    role: string;
    name?: string | null;
  };
  payload?: Record<string, any>;
  reason?: string;
}

@Injectable()
export class PickupStateMachineService {
  private readonly logger = new Logger(PickupStateMachineService.name);

  constructor(
    @InjectModel(PickupEvent.name)
    private readonly eventModel: Model<PickupEventDocument>,
    @Optional() private readonly outboxService?: OutboxService,
  ) {}

  /**
   * Allowed transitions mapping based on Section 6 state machine.
   * Maps current status -> array of valid destination statuses.
   */
  private readonly allowedTransitions: Record<PickupStatus, PickupStatus[]> = {
    [PickupStatus.REQUESTED]: [PickupStatus.SCHEDULED, PickupStatus.CANCELLED],
    [PickupStatus.SCHEDULED]: [PickupStatus.ASSIGNED, PickupStatus.CANCELLED],
    [PickupStatus.ASSIGNED]: [PickupStatus.ON_THE_WAY, PickupStatus.CANCELLED],
    [PickupStatus.ON_THE_WAY]: [PickupStatus.ARRIVED, PickupStatus.CANCELLED],
    [PickupStatus.ARRIVED]: [PickupStatus.VERIFIED, PickupStatus.FAILED, PickupStatus.CANCELLED],
    [PickupStatus.VERIFIED]: [PickupStatus.IN_PROGRESS, PickupStatus.FAILED],
    [PickupStatus.IN_PROGRESS]: [PickupStatus.MEASURED, PickupStatus.FAILED],
    [PickupStatus.MEASURED]: [PickupStatus.SUMMARY_READY, PickupStatus.FAILED],
    [PickupStatus.SUMMARY_READY]: [PickupStatus.CUSTOMER_CONFIRMED, PickupStatus.MEASURED, PickupStatus.FAILED],
    [PickupStatus.CUSTOMER_CONFIRMED]: [PickupStatus.SETTLED, PickupStatus.PAYMENT_PENDING, PickupStatus.MEASURED],
    [PickupStatus.PAYMENT_PENDING]: [PickupStatus.SETTLED, PickupStatus.FAILED],
    [PickupStatus.SETTLED]: [PickupStatus.OTP_VERIFIED],
    [PickupStatus.OTP_VERIFIED]: [PickupStatus.INVOICED],
    [PickupStatus.INVOICED]: [PickupStatus.COMPLETED],
    [PickupStatus.COMPLETED]: [],
    [PickupStatus.CANCELLED]: [],
    [PickupStatus.FAILED]: [],
  };

  /**
   * Validates if a transition is allowed according to the state machine matrix and role guards.
   */
  validateTransition(ctx: TransitionContext): void {
    const { pickup, toStatus, actor, payload } = ctx;
    const fromStatus = pickup.status;

    const allowedNext = this.allowedTransitions[fromStatus] || [];
    if (!allowedNext.includes(toStatus)) {
      throw new BadRequestException(
        `Invalid status transition: Cannot move pickup from ${fromStatus} to ${toStatus}`,
      );
    }

    // Role and State Guards
    switch (toStatus) {
      case PickupStatus.SCHEDULED:
        if (actor.role !== UserRole.ADMIN && actor.role !== 'SYSTEM') {
          throw new ForbiddenException('Only system or admin can schedule pickups');
        }
        break;

      case PickupStatus.ASSIGNED:
        if (actor.role !== UserRole.ADMIN) {
          throw new ForbiddenException('Only operations admin can assign employees');
        }
        break;

      case PickupStatus.ON_THE_WAY:
      case PickupStatus.ARRIVED:
      case PickupStatus.VERIFIED:
      case PickupStatus.IN_PROGRESS:
      case PickupStatus.MEASURED:
      case PickupStatus.SETTLED:
        if (actor.role !== UserRole.EMPLOYEE && actor.role !== 'SYSTEM') {
          throw new ForbiddenException('Only the assigned employee can perform this field action');
        }
        if (pickup.assignment?.employeeProfileId && payload?.employeeProfileId) {
          if (pickup.assignment.employeeProfileId.toString() !== payload.employeeProfileId.toString()) {
            throw new ForbiddenException('Only the assigned employee for this pickup can take action');
          }
        }
        break;

      case PickupStatus.OTP_VERIFIED:
      case PickupStatus.INVOICED:
      case PickupStatus.COMPLETED:
        if (actor.role !== UserRole.EMPLOYEE && actor.role !== 'SYSTEM') {
          throw new ForbiddenException('Only the assigned employee or system can complete the pickup');
        }
        break;

      case PickupStatus.CUSTOMER_CONFIRMED:
        if (actor.role !== UserRole.CUSTOMER) {
          throw new ForbiddenException('Only the customer can approve the pickup summary');
        }
        if (pickup.customerId.toString() !== actor.userId) {
          throw new ForbiddenException('You can only approve summaries for your own pickups');
        }
        break;

      case PickupStatus.CANCELLED:
        // Before ON_THE_WAY: customer or admin can cancel.
        // After ON_THE_WAY: admin only!
        const isPastOnTheWay = [
          PickupStatus.ON_THE_WAY,
          PickupStatus.ARRIVED,
          PickupStatus.VERIFIED,
          PickupStatus.IN_PROGRESS,
        ].includes(fromStatus);

        if (isPastOnTheWay && actor.role !== UserRole.ADMIN) {
          throw new ForbiddenException(
            'Pickup cannot be cancelled by customer once the employee is on the way. Please contact support.',
          );
        }
        if (!ctx.reason) {
          throw new BadRequestException('A reason is required to cancel a pickup');
        }
        break;

      case PickupStatus.FAILED:
        if (!ctx.reason) {
          throw new BadRequestException('A reason is required to mark a pickup as failed');
        }
        break;
    }
  }

  /**
   * Applies the transition to the pickup document and records an append-only PickupEvent.
   */
  async transition(ctx: TransitionContext): Promise<PickupDocument> {
    this.validateTransition(ctx);

    const { pickup, toStatus, actor, payload, reason } = ctx;
    const fromStatus = pickup.status;
    const now = new Date();

    pickup.status = toStatus;

    // Update corresponding timestamp
    this.updateTimestamps(pickup, toStatus, now);

    if (toStatus === PickupStatus.CANCELLED || toStatus === PickupStatus.FAILED) {
      pickup.closure = {
        reason: reason || 'Closed',
        notes: payload?.notes || null,
        closedBy: actor.userId || null,
      };
    }

    await pickup.save();

    // Append-only event log
    await this.eventModel.create({
      pickupId: pickup._id.toString(),
      eventType: `STATUS_${toStatus}`,
      fromStatus,
      toStatus,
      actor: {
        userId: actor.userId || null,
        role: actor.role,
        name: actor.name || null,
      },
      payload: { ...payload, reason },
    });

    this.logger.log(
      `Pickup ${pickup.pickupCode} transitioned from ${fromStatus} -> ${toStatus} by ${actor.role}`,
    );

    if (this.outboxService) {
      await this.outboxService.createEvent('pickup.status_changed', {
        pickupId: pickup._id.toString(),
        pickupCode: pickup.pickupCode,
        customerId: pickup.customerId,
        fromStatus,
        toStatus,
        actorRole: actor.role,
        reason: reason || null,
      });
    }

    return pickup;
  }

  private updateTimestamps(pickup: PickupDocument, status: PickupStatus, now: Date): void {
    if (!pickup.timestamps) {
      pickup.timestamps = {} as any;
    }
    switch (status) {
      case PickupStatus.SCHEDULED:
        pickup.timestamps.scheduledAt = now;
        break;
      case PickupStatus.ASSIGNED:
        pickup.timestamps.assignedAt = now;
        break;
      case PickupStatus.ON_THE_WAY:
        pickup.timestamps.onTheWayAt = now;
        break;
      case PickupStatus.ARRIVED:
        pickup.timestamps.arrivedAt = now;
        break;
      case PickupStatus.VERIFIED:
        pickup.timestamps.verifiedAt = now;
        break;
      case PickupStatus.IN_PROGRESS:
        pickup.timestamps.startedAt = now;
        break;
      case PickupStatus.MEASURED:
        pickup.timestamps.measuredAt = now;
        break;
      case PickupStatus.CUSTOMER_CONFIRMED:
        pickup.timestamps.confirmedAt = now;
        break;
      case PickupStatus.SETTLED:
        pickup.timestamps.settledAt = now;
        break;
      case PickupStatus.OTP_VERIFIED:
        pickup.timestamps.otpVerifiedAt = now;
        break;
      case PickupStatus.INVOICED:
        pickup.timestamps.invoicedAt = now;
        break;
      case PickupStatus.COMPLETED:
        pickup.timestamps.completedAt = now;
        break;
      case PickupStatus.CANCELLED:
        pickup.timestamps.cancelledAt = now;
        break;
      case PickupStatus.FAILED:
        pickup.timestamps.failedAt = now;
        break;
    }
  }
}
