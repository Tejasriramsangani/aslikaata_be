import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;

export enum DevicePlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
  WEB = 'WEB',
}

/** One FCM registration token per installed app. A user can have several (phone + tablet). */
@Schema({ collection: 'devicetokens', timestamps: true })
export class DeviceToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId: string;

  /** FCM registration token. Unique: if another account logs in on the same phone it takes over the token. */
  @Prop({ required: true, unique: true })
  token: string;

  @Prop({ type: String, enum: DevicePlatform, default: DevicePlatform.ANDROID })
  platform: DevicePlatform;

  @Prop({ type: String, default: null })
  appVersion?: string | null;

  @Prop({ type: Date, default: () => new Date() })
  lastSeenAt: Date;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);
