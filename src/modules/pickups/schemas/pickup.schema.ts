import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { PickupStatus, SettlementPreference } from './pickup-status.enum.js';

export type PickupDocument = HydratedDocument<Pickup>;

@Schema({ _id: false })
export class AddressSnapshot {
  @Prop({ type: String, required: true })
  line1: string;

  @Prop({ type: String, default: '' })
  line2?: string;

  @Prop({ type: String, required: true })
  city: string;

  @Prop({ type: String, required: true })
  state: string;

  @Prop({ type: String, required: true })
  pincode: string;

  @Prop({
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
    },
    coordinates: {
      type: [Number],
      required: true,
    },
  })
  location: { type: string; coordinates: number[] };

  @Prop({ type: String, default: null })
  landmark?: string | null;
}
export const AddressSnapshotSchema = SchemaFactory.createForClass(AddressSnapshot);

@Schema({ _id: false })
export class TimeSlotSnapshot {
  @Prop({ type: String, required: true })
  startTime: string;

  @Prop({ type: String, required: true })
  endTime: string;

  @Prop({ type: String, required: true })
  displayLabel: string;
}
export const TimeSlotSnapshotSchema = SchemaFactory.createForClass(TimeSlotSnapshot);

@Schema({ _id: false })
export class WeightRangeSnapshot {
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  displayLabel: string;

  @Prop({ type: Number, required: true })
  minGrams: number;

  @Prop({ type: Number, required: true })
  maxGrams: number;
}
export const WeightRangeSnapshotSchema = SchemaFactory.createForClass(WeightRangeSnapshot);

@Schema({ _id: false })
export class PickupAssignment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'EmployeeProfile', required: true })
  employeeProfileId: string;

  @Prop({ type: String, required: true })
  employeeCode: string;

  @Prop({ type: String, required: true })
  employeeName: string;

  @Prop({ type: String, required: true })
  vehicleType: string;

  @Prop({ type: String, required: true })
  vehicleNumber: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  assignedAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  assignedBy: string;
}
export const PickupAssignmentSchema = SchemaFactory.createForClass(PickupAssignment);

@Schema({ _id: false })
export class PickupTimestamps {
  @Prop({ type: Date, default: () => new Date() })
  requestedAt: Date;

  @Prop({ type: Date, default: null })
  scheduledAt?: Date | null;

  @Prop({ type: Date, default: null })
  assignedAt?: Date | null;

  @Prop({ type: Date, default: null })
  onTheWayAt?: Date | null;

  @Prop({ type: Date, default: null })
  arrivedAt?: Date | null;

  @Prop({ type: Date, default: null })
  verifiedAt?: Date | null;

  @Prop({ type: Date, default: null })
  startedAt?: Date | null;

  @Prop({ type: Date, default: null })
  measuredAt?: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;

  @Prop({ type: Date, default: null })
  settledAt?: Date | null;

  @Prop({ type: Date, default: null })
  otpVerifiedAt?: Date | null;

  @Prop({ type: Date, default: null })
  invoicedAt?: Date | null;

  @Prop({ type: Date, default: null })
  completedAt?: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt?: Date | null;

  @Prop({ type: Date, default: null })
  failedAt?: Date | null;
}
export const PickupTimestampsSchema = SchemaFactory.createForClass(PickupTimestamps);

@Schema({ _id: false })
export class PickupItem {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ScrapProduct', required: true })
  productId: string;

  @Prop({ type: String, required: true })
  productName: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ScrapCategory', required: true })
  categoryId: string;

  @Prop({ type: Number, required: true, min: 1 })
  grossWeightGrams: number;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  wastageGrams: number;

  @Prop({ type: Number, required: true, min: 1 })
  netWeightGrams: number;

  @Prop({ type: String, default: null })
  wastageReason?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ScrapRate', required: true })
  rateId: string;

  @Prop({ type: Number, required: true })
  ratePerKgSnapshot: number; // in integer paise

  @Prop({ type: Number, required: true })
  amount: number; // in integer paise
}
export const PickupItemSchema = SchemaFactory.createForClass(PickupItem);

@Schema({ _id: false })
export class PickupTotals {
  @Prop({ type: Number, required: true, default: 0 })
  grossWeightGrams: number;

  @Prop({ type: Number, required: true, default: 0 })
  wastageGrams: number;

  @Prop({ type: Number, required: true, default: 0 })
  netWeightGrams: number;

  @Prop({ type: Number, required: true, default: 0 })
  totalAmount: number; // in integer paise
}
export const PickupTotalsSchema = SchemaFactory.createForClass(PickupTotals);

@Schema({ _id: false })
export class PickupConfirmation {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  confirmedBy?: string | null;

  @Prop({ type: String, default: 'IN_APP' })
  method: string;

  @Prop({ type: String, default: null })
  summaryHash?: string | null;

  @Prop({ type: Date, default: null })
  confirmedAt?: Date | null;
}
export const PickupConfirmationSchema = SchemaFactory.createForClass(PickupConfirmation);

@Schema({ _id: false })
export class PickupClosure {
  @Prop({ type: String, default: null })
  reason?: string | null;

  @Prop({ type: String, default: null })
  notes?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  closedBy?: string | null;
}
export const PickupClosureSchema = SchemaFactory.createForClass(PickupClosure);

@Schema({ _id: false })
export class PickupPreparation {
  @Prop({ type: [String], default: [] })
  tools: string[];

  @Prop({ type: String, default: '' })
  remarks: string;
}
export const PickupPreparationSchema = SchemaFactory.createForClass(PickupPreparation);

@Schema({ _id: false })
export class PickupPhoto {
  @Prop({ type: String, required: true })
  fileUrl: string;

  @Prop({ type: Date, default: () => new Date() })
  uploadedAt: Date;
}
export const PickupPhotoSchema = SchemaFactory.createForClass(PickupPhoto);

@Schema({ collection: 'pickups', timestamps: true })
export class Pickup {
  @Prop({ type: String, required: true, unique: true, index: true })
  pickupCode: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  customerId: string;

  @Prop({ type: AddressSnapshotSchema, required: true })
  addressSnapshot: AddressSnapshot;

  @Prop({ type: String, required: true, index: true })
  scheduledDate: string; // "YYYY-MM-DD"

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'TimeSlot', required: true })
  timeSlotId: string;

  @Prop({ type: TimeSlotSnapshotSchema, required: true })
  timeSlotSnapshot: TimeSlotSnapshot;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'WeightRange', required: true })
  estimatedWeightRangeId: string;

  @Prop({ type: WeightRangeSnapshotSchema, required: true })
  estimatedWeightSnapshot: WeightRangeSnapshot;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'ScrapCategory' }], default: [] })
  categories: string[];

  @Prop({ type: String, required: true, enum: SettlementPreference, default: SettlementPreference.CASH })
  settlementPreference: SettlementPreference;

  @Prop({ type: String, required: true, enum: PickupStatus, default: PickupStatus.REQUESTED, index: true })
  status: PickupStatus;

  @Prop({ type: PickupAssignmentSchema, default: null })
  assignment?: PickupAssignment | null;

  @Prop({ type: PickupTimestampsSchema, default: () => ({ requestedAt: new Date() }) })
  timestamps: PickupTimestamps;

  @Prop({ type: PickupPreparationSchema, default: () => ({ tools: [], remarks: '' }) })
  preparation: PickupPreparation;

  @Prop({ type: [PickupPhotoSchema], default: [] })
  photos: PickupPhoto[];

  @Prop({ type: [PickupItemSchema], default: [] })
  items: PickupItem[];

  @Prop({ type: PickupTotalsSchema, default: () => ({ grossWeightGrams: 0, wastageGrams: 0, netWeightGrams: 0, totalAmount: 0 }) })
  totals: PickupTotals;

  @Prop({ type: PickupConfirmationSchema, default: () => ({}) })
  confirmation: PickupConfirmation;

  @Prop({ type: PickupClosureSchema, default: () => ({}) })
  closure: PickupClosure;
}

export const PickupSchema = SchemaFactory.createForClass(Pickup);
PickupSchema.index({ status: 1, scheduledDate: 1 });
PickupSchema.index({ 'assignment.employeeProfileId': 1, status: 1 });
PickupSchema.index({ customerId: 1, createdAt: -1 });
PickupSchema.index({ 'addressSnapshot.pincode': 1 });
PickupSchema.index({ 'timestamps.completedAt': 1 });
