import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type CustomerProfileDocument = HydratedDocument<CustomerProfile>;

@Schema({ collection: 'customerprofiles', timestamps: true })
export class CustomerProfile {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId: string;

  @Prop({ required: true, trim: true })
  fullName: string;

  @Prop({ default: null, trim: true, lowercase: true })
  email?: string | null;

  @Prop({ default: null })
  dateOfBirth?: Date | null;
}

export const CustomerProfileSchema = SchemaFactory.createForClass(CustomerProfile);
