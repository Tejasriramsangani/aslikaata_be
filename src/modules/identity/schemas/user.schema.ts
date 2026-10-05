import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole } from '../../../common/decorators/roles.decorator.js';

export type UserDocument = HydratedDocument<User>;

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true, trim: true })
  mobile: string;

  @Prop({
    type: [String],
    enum: UserRole,
    default: [UserRole.CUSTOMER],
  })
  roles: UserRole[];

  @Prop({ required: true, enum: UserStatus, default: UserStatus.ACTIVE })
  status: UserStatus;

  @Prop({ default: '1.0' })
  termsVersion: string;

  @Prop({ default: () => new Date() })
  termsAcceptedAt: Date;

  @Prop({ default: null })
  lastLoginAt?: Date | null;

  @Prop({ default: null })
  deletedAt?: Date | null;

  @Prop({ default: null })
  anonymizedAt?: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
