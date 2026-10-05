import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { PickupStatus } from './pickup-status.enum.js';

export type PickupEventDocument = HydratedDocument<PickupEvent>;

@Schema({ _id: false })
export class EventActor {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  userId?: string | null;

  @Prop({ type: String, required: true })
  role: string; // CUSTOMER, EMPLOYEE, ADMIN, SYSTEM

  @Prop({ type: String, default: null })
  name?: string | null;
}

export const EventActorSchema = SchemaFactory.createForClass(EventActor);

@Schema({
  collection: 'pickupevents',
  timestamps: { createdAt: 'occurredAt', updatedAt: false },
})
export class PickupEvent {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', required: true, index: true })
  pickupId: string;

  @Prop({ type: String, required: true })
  eventType: string;

  @Prop({ type: String, required: true, enum: PickupStatus })
  fromStatus: PickupStatus;

  @Prop({ type: String, required: true, enum: PickupStatus })
  toStatus: PickupStatus;

  @Prop({ type: EventActorSchema, required: true })
  actor: EventActor;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  payload?: Record<string, any>;
}

export const PickupEventSchema = SchemaFactory.createForClass(PickupEvent);
PickupEventSchema.index({ pickupId: 1, occurredAt: 1 });
