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

  @Prop({ type: String, required: true, enum: OtpPurpose })
  purpose: OtpPurpose;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Pickup', default: null })
  pickupId?: string | null;

  /**
   * For the pickup completion code: the weighing summary the customer was looking at when the code was
   * issued. Sharing the code confirms exactly that summary, so if the amounts change afterwards the code
   * stops working and a new one is issued.
   */
  @Prop({ type: String, default: null })
  summaryHash?: string | null;

  @Prop({ required: true })
  codeHash: string;

  /** SMS for login codes; APP for the pickup completion code the customer reads out of their app. */
  @Prop({ default: 'SMS' })
  channel: string;

  /**
   * AES-encrypted copy of the code. Only set for APP-channel codes, which the customer app must be able
   * to show. Login codes are never stored in a readable form.
   */
  @Prop({ type: String, default: null })
  codeEnc?: string | null;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: 3 })
  maxAttempts: number;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ required: true })
  resendCooldownUntil: Date;

  @Prop({ type: Date, default: null })
  consumedAt?: Date | null;
}

export const OtpChallengeSchema = SchemaFactory.createForClass(OtpChallenge);
OtpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
OtpChallengeSchema.index({ mobile: 1, purpose: 1, consumedAt: 1 });
