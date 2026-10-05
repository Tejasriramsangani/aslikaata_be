import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TimeSlotDocument = HydratedDocument<TimeSlot>;

@Schema({ collection: 'timeslots', timestamps: true })
export class TimeSlot {
  @Prop({ required: true, trim: true })
  startTime: string; // "09:00"

  @Prop({ required: true, trim: true })
  endTime: string; // "12:00"

  @Prop({ required: true, trim: true })
  displayLabel: string; // "09:00 AM - 12:00 PM"

  @Prop({ required: true, default: 10, min: 1 })
  maxPickups: number; // Maximum pickup capacity for this slot

  @Prop({ default: 0 })
  displayOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const TimeSlotSchema = SchemaFactory.createForClass(TimeSlot);
TimeSlotSchema.index({ displayOrder: 1 });
