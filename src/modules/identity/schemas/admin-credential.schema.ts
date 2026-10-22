import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AdminCredentialDocument = HydratedDocument<AdminCredential>;

@Schema({ collection: 'admincredentials', timestamps: true })
export class AdminCredential {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: string;

  @Prop({ required: true, unique: true, index: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, default: 'Admin User' })
  name: string;

  @Prop({ type: String, default: 'SUPER_ADMIN' })
  role: string;

  @Prop({ type: String, default: 'All Andhra Divisions' })
  assignedDivision: string;

  @Prop({ type: String, default: null })
  totpSecretEnc?: string | null;

  @Prop({ default: false })
  isTotpEnabled: boolean;

  @Prop({ default: 0 })
  failedLoginAttempts: number;

  @Prop({ type: Date, default: null })
  lockedUntil?: Date | null;
}

export const AdminCredentialSchema = SchemaFactory.createForClass(AdminCredential);
