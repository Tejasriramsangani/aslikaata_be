import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { DocType, DocumentStatus } from '../schemas/employee-document.schema.js';
import { EmployeeStatus } from '../schemas/employee-profile.schema.js';

export class CreateEmployeeProfileDto {
  @IsNotEmpty()
  @IsString()
  fullName: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;
}

export class UploadEmployeeDocumentDto {
  @IsNotEmpty()
  @IsEnum(DocType)
  docType: DocType;

  @IsNotEmpty()
  @IsString()
  rawIdentifier: string; // Will be AES-256 encrypted and masked before saving

  @IsNotEmpty()
  @IsString()
  fileUrl: string;

  @IsOptional()
  @IsDateString()
  expiresOn?: string;
}

export class ReviewDocumentDto {
  @IsNotEmpty()
  @IsEnum(DocumentStatus)
  status: DocumentStatus;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export class ReviewEmployeeStatusDto {
  @IsNotEmpty()
  @IsEnum(EmployeeStatus)
  status: EmployeeStatus;

  @IsOptional()
  @IsString()
  reason?: string;
}
