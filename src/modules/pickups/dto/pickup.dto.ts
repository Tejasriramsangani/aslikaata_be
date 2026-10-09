import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { SettlementPreference } from '../schemas/pickup-status.enum.js';

export class RequestPickupDto {
  @IsNotEmpty()
  @IsString()
  addressId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be in YYYY-MM-DD format' })
  scheduledDate: string;

  @IsNotEmpty()
  @IsString()
  timeSlotId: string;

  @IsNotEmpty()
  @IsString()
  estimatedWeightRangeId: string;

  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];

  @IsNotEmpty()
  @IsEnum(SettlementPreference)
  settlementPreference: SettlementPreference;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];
}

export class UpdatePreparationDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoUrls?: string[];
}

export class AssignPickupDto {
  @IsNotEmpty()
  @IsString()
  employeeProfileId: string;

  @IsNotEmpty()
  @IsString()
  vehicleType: string;

  @IsNotEmpty()
  @IsString()
  vehicleNumber: string;
}

export class CancelPickupDto {
  @IsNotEmpty()
  @IsString()
  reason: string;
}

export class FailPickupDto {
  @IsNotEmpty()
  @IsString()
  reason: string;
}

export class ReschedulePickupDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate must be in YYYY-MM-DD format' })
  scheduledDate: string;

  @IsOptional()
  @IsString()
  timeSlotId?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateCategoriesDto {
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  categoryIds: string[];
}

