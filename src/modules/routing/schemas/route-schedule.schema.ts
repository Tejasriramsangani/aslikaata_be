import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type RouteScheduleDocument = HydratedDocument<RouteSchedule>;

@Schema({ collection: 'routeschedules', timestamps: true })
export class RouteSchedule {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vehicle', required: true, index: true })
  vehicleId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Division', required: true, index: true })
  divisionId: string;

  @Prop({ type: Number, required: true, min: 1, max: 7, index: true })
  weekday: number; // 1 = Monday, 2 = Tuesday, ..., 7 = Sunday

  @Prop({ type: String, required: true, default: '09:00' })
  windowStart: string; // "HH:MM" e.g. "09:00"

  @Prop({ type: String, required: true, default: '13:00' })
  windowEnd: string; // "HH:MM" e.g. "13:00"

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'EmployeeProfile', default: null })
  defaultEmployeeId?: string | null;

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ type: Date, required: true, default: () => new Date() })
  effectiveFrom: Date;

  @Prop({ type: Date, default: null })
  effectiveTo?: Date | null;
}

export const RouteScheduleSchema = SchemaFactory.createForClass(RouteSchedule);
RouteScheduleSchema.index({ vehicleId: 1, weekday: 1, effectiveFrom: 1 }, { unique: true });
RouteScheduleSchema.index({ divisionId: 1, weekday: 1 });
RouteScheduleSchema.index({ vehicleId: 1, weekday: 1 });
