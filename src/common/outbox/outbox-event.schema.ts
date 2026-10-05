import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type OutboxEventDocument = HydratedDocument<OutboxEvent>;

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
}

@Schema({ collection: 'outboxevents', timestamps: { createdAt: 'occurredAt', updatedAt: 'processedAt' } })
export class OutboxEvent {
  @Prop({ required: true })
  eventType: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload: Record<string, any>;

  @Prop({ required: true, enum: OutboxStatus, default: OutboxStatus.PENDING })
  status: OutboxStatus;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: null })
  error?: string;
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);
OutboxEventSchema.index({ status: 1, occurredAt: 1 });
