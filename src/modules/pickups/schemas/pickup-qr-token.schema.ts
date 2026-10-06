import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type PickupQrTokenDocument = HydratedDocument<PickupQrToken>;

@Schema({ collection: 'pickupqrtokens', timestamps: true })
export class PickupQrToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', required: true, index: true })
  pickupId: string;

  @Prop({ required: true, index: true })
  tokenHash: string; // SHA-256 hash of the dynamic QR secret

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ type: Date, default: null })
  usedAt?: Date | null;
}

export const PickupQrTokenSchema = SchemaFactory.createForClass(PickupQrToken);
PickupQrTokenSchema.index({ pickupId: 1, usedAt: 1, expiresAt: 1 });
