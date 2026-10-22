import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type YardStockDocument = HydratedDocument<YardStock>;

@Schema({ collection: 'operations_yard_stock', timestamps: true })
export class YardStock {
  @Prop({ required: true, trim: true })
  categoryName: string;

  @Prop({ required: true, trim: true })
  productName: string;

  @Prop({
    default: 'BALED_READY_FOR_SALE',
    enum: ['RAW_UNSORTED', 'SORTING_IN_PROGRESS', 'BALED_READY_FOR_SALE'],
  })
  stage: string;

  @Prop({ default: 'Vijayawada Central - Bay A1' })
  yardLocation: string;

  @Prop({ required: true, default: 0 })
  currentTonnageKg: number;

  @Prop({ required: true, default: 0 })
  averageInwardCostPerKgRupees: number;

  @Prop({ required: true, default: 0 })
  marketWholesaleRatePerKgRupees: number;

  @Prop({ required: true, default: 0 })
  unrealizedGrossMarginRupees: number;

  @Prop({ default: () => new Date().toISOString() })
  lastUpdated: string;
}

export const YardStockSchema = SchemaFactory.createForClass(YardStock);
