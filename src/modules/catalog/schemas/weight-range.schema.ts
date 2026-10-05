import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WeightRangeDocument = HydratedDocument<WeightRange>;

@Schema({ collection: 'weightranges', timestamps: true })
export class WeightRange {
  @Prop({ required: true, trim: true })
  name: string; // e.g. "SMALL", "MEDIUM", "LARGE", "COMMERCIAL"

  @Prop({ required: true, trim: true })
  displayLabel: string; // e.g. "Below 20 kg", "20 - 50 kg"

  @Prop({ required: true, min: 0 })
  minGrams: number;

  @Prop({ required: true, min: 0 })
  maxGrams: number;

  @Prop({ default: 0 })
  displayOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const WeightRangeSchema = SchemaFactory.createForClass(WeightRange);
WeightRangeSchema.index({ displayOrder: 1 });
