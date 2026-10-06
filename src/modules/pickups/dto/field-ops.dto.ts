import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class VerifyQrDto {
  @IsNotEmpty()
  @IsString()
  qrToken: string;
}

export class ItemMeasurementInput {
  @IsNotEmpty()
  @IsString()
  productId: string;

  /**
   * Gross scale weight in integer grams (e.g. 5200 for 5.2 kg).
   */
  @IsNotEmpty()
  @IsInt({ message: 'grossWeightGrams must be an integer' })
  @Min(1, { message: 'grossWeightGrams must be greater than 0' })
  grossWeightGrams: number;

  /**
   * Wastage deduction in integer grams (e.g. 200 for 0.2 kg).
   * Must be >= 0 and strictly < grossWeightGrams (enforced by service).
   */
  @IsNotEmpty()
  @IsInt({ message: 'wastageGrams must be an integer' })
  @Min(0, { message: 'wastageGrams cannot be negative' })
  wastageGrams: number;

  @IsOptional()
  @IsString()
  wastageReason?: string;
}

export class RecordItemsDto {
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one scrap item must be recorded' })
  @ValidateNested({ each: true })
  @Type(() => ItemMeasurementInput)
  items: ItemMeasurementInput[];
}

export class ApproveSummaryDto {
  @IsNotEmpty()
  @IsString()
  summaryHash: string;
}
