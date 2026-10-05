import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AddressDocument = HydratedDocument<Address>;

@Schema({ _id: false })
export class GeoLocation {
  @Prop({ type: String, enum: ['Point'], default: 'Point' })
  type: string;

  @Prop({ type: [Number], required: true }) // [longitude, latitude]
  coordinates: number[];
}

export const GeoLocationSchema = SchemaFactory.createForClass(GeoLocation);

@Schema({ collection: 'addresses', timestamps: true })
export class Address {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: string;

  @Prop({ required: true, trim: true })
  line1: string;

  @Prop({ default: '', trim: true })
  line2?: string | null;

  @Prop({ required: true, trim: true })
  city: string;

  @Prop({ required: true, trim: true })
  state: string;

  @Prop({ required: true, trim: true, index: true })
  pincode: string;

  @Prop({ type: GeoLocationSchema, required: true })
  location: GeoLocation;

  @Prop({ default: false })
  isDefault: boolean;

  @Prop({ default: null })
  landmark?: string | null;
}

export const AddressSchema = SchemaFactory.createForClass(Address);
AddressSchema.index({ location: '2dsphere' });
AddressSchema.index({ userId: 1, isDefault: 1 });
