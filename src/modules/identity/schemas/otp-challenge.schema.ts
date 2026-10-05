import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type OtpChallengeDocument = HydratedDocument<OtpChallenge>;

export enum OtpPurpose {
  LOGIN = 'LOGIN',
  PICKUP_COMPLETION = 'PICKUP_COMPLETION',
}

@Schema({ collection: 'otpchallenges', timestamps: true })
export class OtpChallenge {
  @Prop({ required: true, index: true })
  mobile: string;

  @Prop({ required: true, enum: OtpPurpose })
  purpose: OtpPurpose;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', default: null })
  pickupId?: string | null;

  @Prop({ required: true })
  codeHash: string;

  @Prop({ default: 'SMS' })
  channel: string;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: 3 })
  maxAttempts: number;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ required: true })
  resendCooldownUntil: Date;

  @Prop({ default: null })
  consumedAt?: Date | null;
}

export const OtpChallengeSchema = SchemaFactory.createForClass(OtpChallenge);
OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpChallengeSchema.index({ mobile: 1, purpose: 1, consumedAt: 1 });
