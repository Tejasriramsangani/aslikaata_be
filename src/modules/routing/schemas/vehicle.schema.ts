import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type VehicleDocument = HydratedDocument<Vehicle>;

export enum VehicleStatus {
  ACTIVE = 'ACTIVE',
  MAINTENANCE = 'MAINTENANCE',
  RETIRED = 'RETIRED',
}

@Schema({ collection: 'vehicles', timestamps: true })
export class Vehicle {
  @Prop({ required: true, unique: true, uppercase: true, trim: true, index: true })
  registrationNumber: string; // e.g. "AP 16 TE 4092"

  @Prop({ required: true, trim: true })
  name: string; // e.g. "Electric Cargo Van - 01"

  @Prop({ required: true, trim: true })
  vehicleType: string; // e.g. "ELECTRIC_THREE_WHEELER", "TATA_ACE_EV"

  @Prop({ required: true, min: 50, default: 500 })
  capacityKg: number; // in kilograms

  @Prop({ required: true, min: 1, default: 20 })
  maxStops: number;

  @Prop({ type: String, enum: VehicleStatus, default: VehicleStatus.ACTIVE, index: true })
  status: VehicleStatus;

  @Prop({ type: String, default: 'OWNED' })
  ownership: string;

  @Prop({ type: Object, default: {} })
  ownershipDetails: {
    vendorName?: string;
    vendorPhone?: string;
    rentBillingModel?: string;
    rentalChargeRupees?: number;
    contractValidUntil?: string;
    assetValueRupees?: number;
  };

  @Prop({ type: Object, default: {} })
  compliance: {
    fitnessValidUntil?: string;
    insuranceValidUntil?: string;
    pucValidUntil?: string;
    lastServiceOdometer?: number;
  };

  @Prop({ type: Number, default: 0 })
  currentOdometer: number;

  @Prop({ type: String, default: 'Vijayawada Central' })
  assignedDivision: string;

  @Prop({ type: Object, default: {} })
  defaultDriver: {
    name?: string;
    phone?: string;
  };

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'EmployeeProfile', default: null })
  defaultEmployeeId?: string | null;
}

export const VehicleSchema = SchemaFactory.createForClass(Vehicle);
VehicleSchema.index({ status: 1 });
VehicleSchema.index({ defaultEmployeeId: 1 });
