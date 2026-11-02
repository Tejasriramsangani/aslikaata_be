import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PickerAvailability,
  PickerRequestStatus,
  PickerVehicleType,
  PickerWorkType,
} from '../schemas/picker-request.schema.js';

const MOBILE = /^[6-9]\d{9}$/;

export class PickerAddressDto {
  @IsString()
  @Length(5, 200, { message: 'House / street address must be 5-200 characters' })
  line1: string;

  @IsString()
  @Length(2, 100, { message: 'Area / locality is required' })
  area: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @IsString()
  @Length(2, 80, { message: 'City is required' })
  city: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  state?: string;

  @Matches(/^\d{6}$/, { message: 'Pincode must be 6 digits' })
  pincode: string;
}

export class CreatePickerRequestDto {
  @IsString()
  @Length(2, 80, { message: 'Full name must be 2-80 characters' })
  fullName: string;

  @Matches(MOBILE, { message: 'Mobile number must be a valid 10-digit Indian number' })
  mobile: string;

  @IsOptional()
  @Matches(MOBILE, { message: 'Alternate mobile must be a valid 10-digit Indian number' })
  alternateMobile?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email?: string;

  @ValidateNested()
  @Type(() => PickerAddressDto)
  address: PickerAddressDto;

  @IsEnum(PickerWorkType)
  workType: PickerWorkType;

  @IsEnum(PickerVehicleType)
  vehicleType: PickerVehicleType;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehicleNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  experienceYears?: number;

  @IsEnum(PickerAvailability)
  availability: PickerAvailability;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  about?: string;
}

export class RejectPickerRequestDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3, { message: 'Please give a short reason (min 3 characters)' })
  @MaxLength(300)
  reason: string;
}

export class ListPickerRequestsQuery {
  @IsOptional()
  @IsEnum(PickerRequestStatus)
  status?: PickerRequestStatus;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  search?: string;
}
