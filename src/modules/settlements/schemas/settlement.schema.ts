import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type SettlementDocument = HydratedDocument<Settlement>;

export enum SettlementType {
  CASH = 'CASH',
  UPI = 'UPI',
  DONATE = 'DONATE',
}

export enum SettlementStatus {
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
}

@Schema({ collection: 'settlements', timestamps: true })
export class Settlement {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', required: true, unique: true, index: true })
  pickupId: string;

  @Prop({ type: String, required: true, enum: SettlementType })
  type: SettlementType;

  /**
   * Settled amount in integer paise.
   */
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, enum: SettlementStatus, default: SettlementStatus.COMPLETED })
  status: SettlementStatus;

  @Prop({ type: String, default: null, trim: true })
  upiReference?: string | null;

  /**
   * Mandatory unique idempotency key to prevent double settlements on retry.
   */
  @Prop({ type: String, required: true, unique: true, index: true })
  idempotencyKey: string;

  @Prop({ type: String, default: null })
  changedFromType?: string | null;

  @Prop({ type: String, default: null })
  changeReason?: string | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'DonationRecipient', default: null })
  donationRecipientId?: string | null;

  @Prop({ type: String, default: null })
  receiptNumber?: string | null;

  @Prop({ type: Date, required: true, default: () => new Date() })
  settledAt: Date;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);
