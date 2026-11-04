import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type NotificationDocument = HydratedDocument<AppNotification>;

export enum NotificationType {
  PICKUP_ASSIGNED = 'PICKUP_ASSIGNED',
  PICKUP_ON_THE_WAY = 'PICKUP_ON_THE_WAY',
  PICKUP_ARRIVED = 'PICKUP_ARRIVED',
  PICKUP_RESCHEDULED = 'PICKUP_RESCHEDULED',
  /** Admin moved the pickup (e.g. heavy crowd). Customer-facing wording of a reschedule. */
  PICKUP_POSTPONED = 'PICKUP_POSTPONED',
  PICKUP_CANCELLED = 'PICKUP_CANCELLED',
  PICKUP_FAILED = 'PICKUP_FAILED',
  PICKUP_COMPLETED = 'PICKUP_COMPLETED',
  SUMMARY_READY = 'SUMMARY_READY',
  PAYMENT_RECORDED = 'PAYMENT_RECORDED',
  ACCOUNT_APPROVED = 'ACCOUNT_APPROVED',
  GENERAL = 'GENERAL',
}

/** In-app notification for one user (customer or employee app inbox). Also sent as a push. */
@Schema({ collection: 'notifications', timestamps: true })
export class AppNotification {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: string;

  @Prop({ type: String, enum: NotificationType, default: NotificationType.GENERAL })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  /** Deep-link data, e.g. { pickupId, pickupCode }. */
  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop({ type: Date, default: null })
  readAt?: Date | null;
}

export const AppNotificationSchema = SchemaFactory.createForClass(AppNotification);
AppNotificationSchema.index({ userId: 1, createdAt: -1 });
AppNotificationSchema.index({ userId: 1, readAt: 1 });
