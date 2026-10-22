import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ScrapRateDocument = HydratedDocument<ScrapRate>;

@Schema({ collection: 'scraprates', timestamps: { createdAt: true, updatedAt: false } })
export class ScrapRate {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ScrapProduct', required: true, index: true })
  productId: string;

  /**
   * Rate per kilogram in integer paise.
   * e.g., 25.50 Rs/kg = 2550 paise.
   */
  @Prop({ required: true, min: 0 })
  ratePerKg: number;

  @Prop({ required: true, default: () => new Date() })
  effectiveFrom: Date;

  /**
   * Effective end date. If null, this is the currently active rate.
   */
  @Prop({ type: Date, default: null })
  effectiveTo?: Date | null;

  @Prop({ type: Number, default: 0 })
  marketBenchmarkRate?: number;

  @Prop({ type: Number, default: 0 })
  marginDelta?: number;

  @Prop({ type: String, default: 'FLAT' })
  marginType?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdById: string;
}

export const ScrapRateSchema = SchemaFactory.createForClass(ScrapRate);
ScrapRateSchema.index({ productId: 1, effectiveFrom: -1 });
ScrapRateSchema.index({ productId: 1, effectiveTo: 1 });
