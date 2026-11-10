import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type PickerRequestDocument = HydratedDocument<PickerRequest>;

export enum PickerRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum PickerWorkType {
  FIELD_COLLECTOR = 'FIELD_COLLECTOR',
  DRIVER = 'DRIVER',
}

export enum PickerVehicleType {
  NONE = 'NONE',
  BICYCLE = 'BICYCLE',
  BIKE = 'BIKE',
  E_RICKSHAW = 'E_RICKSHAW',
  AUTO = 'AUTO',
  MINI_TRUCK = 'MINI_TRUCK',
}

export enum PickerAvailability {
  FULL_TIME = 'FULL_TIME',
  PART_TIME = 'PART_TIME',
  WEEKENDS = 'WEEKENDS',
}

export const VEHICLE_LABELS: Record<PickerVehicleType, string> = {
  [PickerVehicleType.NONE]: 'No vehicle',
  [PickerVehicleType.BICYCLE]: 'Bicycle',
  [PickerVehicleType.BIKE]: 'Motorbike / Scooter',
  [PickerVehicleType.E_RICKSHAW]: 'E-Rickshaw / Electric 3-Wheeler',
  [PickerVehicleType.AUTO]: 'Auto / Tata Ace',
  [PickerVehicleType.MINI_TRUCK]: 'Mini Truck',
};

/** A "become a freelance picker" application raised from the employee app. */
@Schema({ collection: 'pickerrequests', timestamps: true })
export class PickerRequest {
  @Prop({ required: true, unique: true, index: true })
  requestCode: string; // PR-10001

  @Prop({ required: true, trim: true })
  fullName: string;

  /** 10-digit Indian mobile (no +91). */
  @Prop({ required: true, trim: true })
  mobile: string;

  @Prop({ type: String, default: null })
  alternateMobile?: string | null;

  @Prop({ type: String, default: null })
  email?: string | null;

  @Prop({
    type: {
      line1: { type: String, required: true },
      area: { type: String, required: true },
      landmark: { type: String, default: null },
      city: { type: String, required: true },
      district: { type: String, default: null },
      state: { type: String, default: 'Andhra Pradesh' },
      pincode: { type: String, required: true },
    },
    required: true,
    _id: false,
  })
  address: {
    line1: string;
    area: string;
    landmark?: string | null;
    city: string;
    district?: string | null;
    state: string;
    pincode: string;
  };

  @Prop({ type: String, enum: PickerWorkType, required: true })
  workType: PickerWorkType;

  @Prop({ type: String, enum: PickerVehicleType, default: PickerVehicleType.NONE })
  vehicleType: PickerVehicleType;

  @Prop({ type: String, default: null })
  vehicleNumber?: string | null;

  @Prop({ type: Number, default: 0 })
  experienceYears: number;

  @Prop({ type: String, enum: PickerAvailability, default: PickerAvailability.FULL_TIME })
  availability: PickerAvailability;

  @Prop({ type: String, default: null })
  about?: string | null;

  @Prop({
    type: String,
    enum: PickerRequestStatus,
    default: PickerRequestStatus.PENDING,
    index: true,
  })
  status: PickerRequestStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  reviewedBy?: string | null;

  @Prop({ type: String, default: null })
  reviewedByName?: string | null;

  @Prop({ type: Date, default: null })
  reviewedAt?: Date | null;

  @Prop({ type: String, default: null })
  rejectionReason?: string | null;

  /** Filled on approval: the account that was created for this applicant. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  userId?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'EmployeeProfile', default: null })
  employeeProfileId?: string | null;

  @Prop({ type: String, default: null })
  employeeCode?: string | null;
}

export const PickerRequestSchema = SchemaFactory.createForClass(PickerRequest);
// Only one open request per mobile number at a time.
PickerRequestSchema.index(
  { mobile: 1 },
  { unique: true, partialFilterExpression: { status: PickerRequestStatus.PENDING } },
);
PickerRequestSchema.index({ status: 1, createdAt: -1 });
