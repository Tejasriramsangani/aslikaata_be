import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CustomerProfileDocument = HydratedDocument<CustomerProfile>;

/** The customer's most recent location, refreshed every time the app captures it. */
@Schema({ _id: false })
export class SavedLocation {
  @Prop({ type: Number, required: true })
  latitude: number;

  @Prop({ type: Number, required: true })
  longitude: number;

  @Prop({ type: String, default: '' })
  areaName: string;

  @Prop({ type: String, default: '' })
  city: string;

  @Prop({ type: String, default: '' })
  state: string;

  @Prop({ type: String, default: '' })
  pincode: string;

  @Prop({ type: String, default: '' })
  formattedAddress: string;

  /** Optional house / flat number the customer typed, so the picker can find the door. */
  @Prop({ type: String, default: '' })
  houseNumber: string;

  /** Nearby landmark ("Near Sri Venkateswara Temple"): detected from the map or typed by the customer. */
  @Prop({ type: String, default: '' })
  landmark: string;

  @Prop({ type: Date, required: true })
  updatedAt: Date;
}

export const SavedLocationSchema = SchemaFactory.createForClass(SavedLocation);

@Schema({ collection: 'customerprofiles', timestamps: true })
export class CustomerProfile {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ type: String, default: null, trim: true, lowercase: true })
  email?: string | null;

  @Prop({ type: Date, default: null })
  dateOfBirth?: Date | null;

  @Prop({ type: SavedLocationSchema, default: null })
  lastLocation?: SavedLocation | null;
}

export const CustomerProfileSchema = SchemaFactory.createForClass(CustomerProfile);
