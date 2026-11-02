import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MarketRateDocument = HydratedDocument<MarketRate>;

export type MarketRateSource = 'SEED' | 'MANUAL' | 'FEED';

/**
 * Wholesale / mandi benchmark for one scrap item in one market (e.g. Vijayawada).
 * This is what the business is *paid* / *benchmarks against*; the customer-facing
 * rate is derived from it (benchmark ± margin) and stored in ScrapRate.
 *
 * `code` equals the ScrapProduct.code it feeds, so "enabled" = that product exists,
 * is active, and its category is active. No separate link is stored.
 */
@Schema({ collection: 'marketrates', timestamps: true })
export class MarketRate {
  @Prop({ required: true, uppercase: true, trim: true, index: true })
  marketKey: string; // e.g. VIJAYAWADA

  @Prop({ required: true, uppercase: true, trim: true })
  code: string; // NEWSPAPER, COPPER, ...

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, uppercase: true, trim: true })
  categoryCode: string; // PAPER, METAL, ...

  @Prop({ required: true, trim: true })
  categoryName: string;

  /** Benchmark in integer paise per kg. 0 = not set yet (cannot be enabled). */
  @Prop({ type: Number, default: 0, min: 0 })
  ratePerKgPaise: number;

  @Prop({ type: Number, default: 0, min: 0 })
  previousRatePerKgPaise: number;

  @Prop({ type: String, default: 'SEED' })
  source: MarketRateSource;

  @Prop({ type: Date, default: null })
  rateUpdatedAt?: Date | null;
}

export const MarketRateSchema = SchemaFactory.createForClass(MarketRate);
MarketRateSchema.index({ marketKey: 1, code: 1 }, { unique: true });
