import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type EmployeeProfileDocument = HydratedDocument<EmployeeProfile>;

export enum EmployeeStatus {
  ONBOARDING = 'ONBOARDING',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  SUSPENDED = 'SUSPENDED',
  REJECTED = 'REJECTED',
}

@Schema({ collection: 'employeeprofiles', timestamps: true })
export class EmployeeProfile {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: string;

  @Prop({ required: true, unique: true, index: true })
  employeeCode: string; // e.g. EMP-101

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ default: null })
  dateOfBirth?: Date | null;

  @Prop({ default: null })
  gender?: string | null;

  @Prop({ required: true, enum: EmployeeStatus, default: EmployeeStatus.ONBOARDING, index: true })
  status: EmployeeStatus;

  @Prop({ default: null })
  vehicleType?: string | null;

  @Prop({ default: null })
  vehicleNumber?: string | null;

  @Prop({ default: null })
  approvedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  approvedBy?: string | null;

  @Prop({ default: null })
  suspendedReason?: string | null;

  @Prop({ default: null })
  activeDeviceId?: string | null;
}

export const EmployeeProfileSchema = SchemaFactory.createForClass(EmployeeProfile);
