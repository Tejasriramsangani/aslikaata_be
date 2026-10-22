import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CashFloatDocument = HydratedDocument<CashFloat>;

@Schema({ collection: 'operations_cash_floats', timestamps: true })
export class CashFloat {
  @Prop({ default: () => new Date().toISOString().split('T')[0], index: true })
  date: string;

  @Prop({ required: true, trim: true, uppercase: true })
  employeeCode: string;

  @Prop({ required: true, trim: true })
  employeeName: string;

  @Prop({ default: 'AP 16 TX 4021' })
  vehicleReg: string;

  @Prop({ required: true, min: 0 })
  openingFloatRupees: number;

  @Prop({ default: () => new Date().toLocaleTimeString() })
  issuedTime: string;

  @Prop({ default: 'Admin' })
  issuedByAdmin: string;

  @Prop({ default: 0 })
  verifiedCustomerCashPayoutsRupees: number;

  @Prop({ default: 0 })
  approvedRouteExpensesRupees: number;

  @Prop({ default: 0 })
  expectedCashReturnRupees: number;

  @Prop({ default: null })
  actualPhysicalCashReturnedRupees: number;

  @Prop({ default: 0 })
  varianceRupees: number;

  @Prop({ default: '' })
  reconciledTime: string;

  @Prop({ default: '' })
  reconciledByAdmin: string;

  @Prop({
    default: 'ISSUED',
    enum: ['ISSUED', 'BALANCED', 'SHORTAGE_FLAGGED', 'SURPLUS_FLAGGED'],
    index: true,
  })
  status: string;

  @Prop({ default: '' })
  auditNotes: string;
}

export const CashFloatSchema = SchemaFactory.createForClass(CashFloat);
