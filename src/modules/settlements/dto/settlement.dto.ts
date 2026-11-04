import {
  IsEnum,
  IsIn,
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

  /**
   * How the customer was paid. The completion code is the customer's confirmation, so the payment is
   * recorded together with it. Defaults to CASH.
   */
  @IsOptional()
  @IsIn([SettlementType.CASH, SettlementType.UPI])
  paymentType?: SettlementType.CASH | SettlementType.UPI;

  @IsOptional()
  @IsString()
  upiReference?: string;
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
