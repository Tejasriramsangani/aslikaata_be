import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type EmployeeDocumentDocument = HydratedDocument<EmployeeDocument>;

export enum DocType {
  AADHAAR = 'AADHAAR',
  DRIVING_LICENSE = 'DRIVING_LICENSE',
  VEHICLE_RC = 'VEHICLE_RC',
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

@Schema({ collection: 'employeedocuments', timestamps: true })
export class EmployeeDocument {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'EmployeeProfile', required: true, index: true })
  employeeProfileId: string;

  @Prop({ required: true, enum: DocType })
  docType: DocType;

  @Prop({ required: true })
  identifierEnc: string;

  @Prop({ required: true })
  identifierMasked: string;

  @Prop({ required: true })
  fileUrl: string;

  @Prop({ default: 1 })
  version: number;

  @Prop({ default: true })
  isCurrent: boolean;

  @Prop({ required: true, enum: DocumentStatus, default: DocumentStatus.PENDING, index: true })
  status: DocumentStatus;

  @Prop({ default: null })
  rejectionReason?: string | null;

  @Prop({ default: null })
  expiresOn?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  reviewedBy?: string | null;

  @Prop({ default: null })
  reviewedAt?: Date | null;
}

export const EmployeeDocumentSchema = SchemaFactory.createForClass(EmployeeDocument);
EmployeeDocumentSchema.index({ employeeProfileId: 1, docType: 1, isCurrent: 1 });
