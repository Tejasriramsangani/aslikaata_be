import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ScrapProductDocument = HydratedDocument<ScrapProduct>;

@Schema({ collection: 'scrapproducts', timestamps: true })
export class ScrapProduct {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ScrapCategory', required: true, index: true })
  categoryId: string;

  @Prop({ required: true, trim: true })
  name: string; // Iron, Copper, Brass, Newspaper, etc.

  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string; // IRON, COPPER, NEWSPAPER

  @Prop({ default: '' })
  description?: string | null;

  @Prop({ default: null })
  imageUrl?: string | null;

  @Prop({ default: true })
  isActive: boolean;
}

export const ScrapProductSchema = SchemaFactory.createForClass(ScrapProduct);
ScrapProductSchema.index({ categoryId: 1, isActive: 1 });
