import { IsEnum, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';
import { OtpPurpose } from '../schemas/otp-challenge.schema.js';
import { UserRole } from '../../../common/decorators/roles.decorator.js';

export class VerifyOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile number must be a valid 10-digit Indian phone number',
  })
  mobile: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  code: string;

  @IsNotEmpty()
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;

  @IsOptional()
  @IsString()
  pickupId?: string;

  @IsOptional()
  @IsEnum(UserRole)
  requestedRole?: UserRole;

  @IsOptional()
  deviceInfo?: Record<string, any>;
}
