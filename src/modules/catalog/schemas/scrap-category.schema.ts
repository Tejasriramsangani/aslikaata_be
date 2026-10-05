import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ScrapCategoryDocument = HydratedDocument<ScrapCategory>;

@Schema({ collection: 'scrapcategories', timestamps: true })
export class ScrapCategory {
  @Prop({ required: true, trim: true })
  name: string; // Paper, Plastic, Metal, E-Waste, Rubber, Others

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string; // PAPER, PLASTIC, METAL, etc.

  @Prop({ default: null })
  iconUrl?: string | null;

  @Prop({ default: 0 })
  displayOrder: number;

  @Prop({ default: true })
  isActive: boolean;
}

export const ScrapCategorySchema = SchemaFactory.createForClass(ScrapCategory);
ScrapCategorySchema.index({ displayOrder: 1 });
