import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DailyStatDocument = HydratedDocument<DailyStat>;

export enum DailyStatScope {
  OVERALL = 'OVERALL',
  CATEGORY = 'CATEGORY',
  PRODUCT = 'PRODUCT',
  EMPLOYEE = 'EMPLOYEE',
  PINCODE = 'PINCODE',
}

@Schema({ collection: 'dailystats', timestamps: true })
export class DailyStat {
  /**
   * Date in ISO format 'YYYY-MM-DD'
   */
  @Prop({ type: String, required: true, index: true })
  date: string;

  @Prop({ type: String, required: true, enum: DailyStatScope, index: true })
  scope: DailyStatScope;

  @Prop({ type: String, default: null, index: true })
  refId?: string | null;

  @Prop({ type: String, default: null, index: true })
  refKey?: string | null;

  @Prop({ type: Number, default: 0 })
  pickupsCompleted: number;

  @Prop({ type: Number, default: 0 })
  pickupsCancelled: number;

  @Prop({ type: Number, default: 0 })
  pickupsFailed: number;

  @Prop({ type: Number, default: 0 })
  grossWeightGrams: number;

  @Prop({ type: Number, default: 0 })
  wastageGrams: number;

  @Prop({ type: Number, default: 0 })
  netWeightGrams: number;

  @Prop({ type: Number, default: 0 })
  totalAmount: number; // in integer paise

  @Prop({ type: Number, default: 0 })
  cashAmount: number; // in integer paise

  @Prop({ type: Number, default: 0 })
  upiAmount: number; // in integer paise

  @Prop({ type: Number, default: 0 })
  donationAmount: number; // in integer paise

  @Prop({ type: Number, default: 0 })
  durationSecondsTotal: number;

  @Prop({ type: Number, default: 0 })
  estimateVarianceGrams: number;
}

export const DailyStatSchema = SchemaFactory.createForClass(DailyStat);
DailyStatSchema.index({ date: 1, scope: 1, refId: 1, refKey: 1 }, { unique: true });
