import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { SettlementType } from '../schemas/settlement.schema.js';

export class RecordSettlementDto {
  @IsNotEmpty()
  @IsEnum(SettlementType)
  type: SettlementType;

  /**
   * Unique client-generated key (UUID) to guarantee idempotency and avoid duplicate payments.
   */
  @IsNotEmpty()
  @IsString()
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  upiReference?: string;

  @IsOptional()
  @IsString()
  donationRecipientId?: string;

  @IsOptional()
  @IsString()
  changeReason?: string;
}

export class VerifyClosingOtpDto {
  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'Closing OTP must be exactly 6 digits' })
  code: string;
}

export class CreateDonationRecipientDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  registrationNumber: string;

  @IsOptional()
  @IsString()
  causeDescription?: string;

  @IsOptional()
  accountDetails?: Record<string, any>;
}
