import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OutwardDispatchDocument = HydratedDocument<OutwardDispatch>;

@Schema({ collection: 'operations_outward_dispatches', timestamps: true })
export class OutwardDispatch {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  gatePassNumber: string;

  @Prop({ required: true, trim: true })
  destinationMillName: string;

  @Prop({ required: true, trim: true })
  destinationCity: string;

  @Prop({ default: 'Metal' })
  categoryName: string;

  @Prop({ required: true, trim: true })
  productName: string;

  @Prop({ required: true, min: 0 })
  dispatchedWeightKg: number;

  @Prop({ required: true, min: 0 })
  agreedMillRatePerKgRupees: number;

  @Prop({ required: true, min: 0 })
  inwardCostPerKgRupees: number;

  @Prop({ required: true, default: 0 })
  grossRealizedMarginRupees: number;

  @Prop({ required: true, default: 0 })
  totalInvoiceValueRupees: number;

  @Prop({ required: true, uppercase: true, trim: true })
  vehicleReg: string;

  @Prop({ default: '' })
  driverName: string;

  @Prop({ default: '' })
  driverPhone: string;

  @Prop({ default: '' })
  eWayBillNumber: string;

  @Prop({
    default: 'PENDING_REMITTANCE',
    enum: ['PAID_FULL', 'PENDING_REMITTANCE', 'PARTIAL_30_DAYS'],
  })
  paymentStatus: string;

  @Prop({ default: () => new Date().toISOString() })
  dispatchTimestamp: string;

  @Prop({ default: 'Yard Manager' })
  authorizedBy: string;
}

export const OutwardDispatchSchema = SchemaFactory.createForClass(OutwardDispatch);
