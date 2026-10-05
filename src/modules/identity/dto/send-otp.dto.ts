import { IsEnum, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { OtpPurpose } from '../schemas/otp-challenge.schema.js';

export class SendOtpDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^[6-9]\d{9}$/, {
    message: 'Mobile number must be a valid 10-digit Indian phone number',
  })
  mobile: string;

  @IsNotEmpty()
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;

  @IsOptional()
  @IsString()
  pickupId?: string;
}
