import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type RouteRunDocument = HydratedDocument<RouteRun>;

export enum RouteRunStatus {
  PLANNED = 'PLANNED',
  FINALIZED = 'FINALIZED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

@Schema({ _id: false })
export class RouteStop {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', required: true })
  pickupId: string;

  @Prop({ type: Number, required: true })
  sequence: number; // 1, 2, 3...

  @Prop({ type: Number, required: true, default: 0 })
  plannedMaxKg: number;

  @Prop({ type: String, default: 'SCHEDULED' })
  status: string;
}
export const RouteStopSchema = SchemaFactory.createForClass(RouteStop);

@Schema({ collection: 'routeruns', timestamps: true })
export class RouteRun {
  @Prop({ required: true, index: true })
  date: string; // YYYY-MM-DD

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Vehicle', required: true, index: true })
  vehicleId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Division', required: true, index: true })
  divisionId: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'EmployeeProfile', default: null, index: true })
  employeeProfileId?: string | null;

  @Prop({ type: String, enum: RouteRunStatus, default: RouteRunStatus.PLANNED, index: true })
  status: RouteRunStatus;

  @Prop({ type: String, required: true, default: '09:00' })
  windowStart: string;

  @Prop({ type: String, required: true, default: '13:00' })
  windowEnd: string;

  @Prop({ type: [RouteStopSchema], default: [] })
  stops: RouteStop[];

  @Prop({ type: Number, default: 0 })
  usedKg: number;

  @Prop({ type: Number, default: 0 })
  usedStops: number;

  @Prop({ type: String, default: null })
  originalDate?: string | null; // Set if moved by holiday
}

export const RouteRunSchema = SchemaFactory.createForClass(RouteRun);
RouteRunSchema.index({ date: 1, divisionId: 1 });
RouteRunSchema.index({ date: 1, status: 1 });
RouteRunSchema.index({ employeeProfileId: 1, date: 1 });
RouteRunSchema.index({ vehicleId: 1, date: 1 });
