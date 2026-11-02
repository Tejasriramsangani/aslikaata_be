import { IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { OtpPurpose } from '../schemas/otp-challenge.schema.js';
import { UserRole } from '../../../common/decorators/roles.decorator.js';

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

  /**
   * Set by the employee app: only send an OTP if this number already has an employee account.
   * (Without it the OTP flow keeps its old behaviour, e.g. for the customer app.)
   */
  @IsOptional()
  @IsIn([UserRole.EMPLOYEE])
  loginRole?: UserRole.EMPLOYEE;
}
