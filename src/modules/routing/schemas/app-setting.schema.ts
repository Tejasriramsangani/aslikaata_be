import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AppSettingDocument = HydratedDocument<AppSetting>;

@Schema({ collection: 'appsettings', timestamps: true })
export class AppSetting {
  @Prop({ required: true, unique: true, index: true, trim: true })
  key: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value: any;

  @Prop({ type: String, default: '' })
  description?: string;
}

export const AppSettingSchema = SchemaFactory.createForClass(AppSetting);
