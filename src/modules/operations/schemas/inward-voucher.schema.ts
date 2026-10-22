import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type InwardVoucherDocument = HydratedDocument<InwardVoucher>;

export interface InwardItemSubdoc {
  productId: string;
  categoryName: string;
  productName: string;
  ratePerKgRupees: number;
  grossWeightKg: number;
  deductionKg: number;
  deductionReason: string;
  netWeightKg: number;
  lineTotalRupees: number;
}

@Schema({ collection: 'operations_inward_vouchers', timestamps: true })
export class InwardVoucher {
  @Prop({ required: true, unique: true, uppercase: true, trim: true, index: true })
  voucherNumber: string;

  @Prop({
    required: true,
    enum: ['DOORSTEP_PICKUP', 'YARD_WALK_IN', 'B2B_COMMERCIAL'],
    default: 'YARD_WALK_IN',
    index: true,
  })
  channel: string;

  @Prop({ default: 'div_vja_central' })
  divisionId: string;

  @Prop({ default: 'Vijayawada Central Yard' })
  divisionName: string;

  @Prop({ required: true, trim: true })
  sellerName: string;

  @Prop({ default: '' })
  sellerPhone: string;

  @Prop({
    default: 'LOCAL_KABADIS',
    enum: ['HOUSEHOLD', 'LOCAL_KABADIS', 'TRADESMAN', 'CORPORATE_B2B', 'FIELD_PICKER'],
  })
  sellerType: string;

  @Prop({ default: '' })
  vehicleReg: string;

  @Prop({ default: '' })
  assignedCollectorName: string;

  @Prop({ default: 0 })
  truckGrossWeightKg: number;

  @Prop({ default: 0 })
  truckTareWeightKg: number;

  @Prop({ default: '' })
  gstin: string;

  @Prop({ default: '' })
  eWayBillNumber: string;

  @Prop({ type: Array, default: [] })
  items: InwardItemSubdoc[];

  @Prop({ required: true, default: 0 })
  totalGrossKg: number;

  @Prop({ default: 0 })
  totalDeductionKg: number;

  @Prop({ required: true, default: 0 })
  totalNetKg: number;

  @Prop({ required: true, default: 0 })
  grandTotalRupees: number;

  @Prop({ default: 'CASH', enum: ['CASH', 'UPI_INSTANT', 'NEFT_RTGS'] })
  paymentMethod: string;

  @Prop({ default: 'PAID' })
  paymentStatus: string;

  @Prop({ default: 'System Operator' })
  operatorName: string;

  @Prop({
    default: 'RECEIVED_VERIFIED',
    enum: ['RECEIVED_VERIFIED', 'PENDING_WEIGHBRIDGE_TARE', 'SHORTAGE_FLAGGED'],
  })
  status: string;

  @Prop({ default: '' })
  reconciliationNotes: string;

  @Prop({ default: () => new Date().toLocaleTimeString() })
  timestamp: string;
}

export const InwardVoucherSchema = SchemaFactory.createForClass(InwardVoucher);
InwardVoucherSchema.index({ channel: 1, createdAt: -1 });
