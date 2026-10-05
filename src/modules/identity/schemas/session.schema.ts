import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

@Schema({ collection: 'sessions', timestamps: true })
export class Session {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: string;

  @Prop({ required: true })
  refreshTokenHash: string;

  @Prop({ required: true, index: true })
  familyId: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  deviceInfo?: Record<string, any>;

  @Prop({ required: true })
  expiresAt: Date;

  @Prop({ default: null })
  revokedAt?: Date | null;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
