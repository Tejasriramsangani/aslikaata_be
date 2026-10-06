import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type InvoiceDocument = HydratedDocument<Invoice>;

export enum InvoiceType {
  CUSTOMER_TAX_INVOICE = 'CUSTOMER_TAX_INVOICE',
  DONATION_RECEIPT = 'DONATION_RECEIPT',
}

@Schema({ _id: false })
export class InvoiceLineItem {
  @Prop({ type: String, required: true })
  productId: string;

  @Prop({ type: String, required: true })
  productName: string;

  @Prop({ type: Number, required: true })
  grossWeightGrams: number;

  @Prop({ type: Number, required: true, default: 0 })
  wastageGrams: number;

  @Prop({ type: Number, required: true })
  netWeightGrams: number;

  @Prop({ type: Number, required: true })
  ratePerKgSnapshot: number; // in integer paise

  @Prop({ type: Number, required: true })
  amount: number; // in integer paise
}
export const InvoiceLineItemSchema = SchemaFactory.createForClass(InvoiceLineItem);

@Schema({ collection: 'invoices', timestamps: { createdAt: 'issuedAt', updatedAt: false } })
export class Invoice {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', required: true, unique: true, index: true })
  pickupId: string;

  /**
   * Sequential human-readable invoice code (format: INV-10001)
   */
  @Prop({ type: String, required: true, unique: true, index: true })
  invoiceNumber: string;

  @Prop({ type: String, required: true, enum: InvoiceType, default: InvoiceType.CUSTOMER_TAX_INVOICE })
  type: InvoiceType;

  @Prop({ type: String, default: null })
  pdfUrl?: string | null;

  @Prop({ type: [InvoiceLineItemSchema], required: true })
  lineItems: InvoiceLineItem[];

  @Prop({ type: Number, required: true, min: 0 })
  grossWeightGrams: number;

  @Prop({ type: Number, required: true, min: 0 })
  wastageGrams: number;

  @Prop({ type: Number, required: true, min: 0 })
  netWeightGrams: number;

  /**
   * Total invoice/receipt value in integer paise.
   */
  @Prop({ type: Number, required: true, min: 0 })
  totalAmount: number;

  @Prop({ type: Object, default: {} })
  settlementDetails?: Record<string, any>;

  @Prop({ type: Date, required: true, default: () => new Date() })
  issuedAt: Date;
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);
