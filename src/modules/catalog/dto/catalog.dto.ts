import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateCategoryDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  iconUrl?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  categoryId: string;

  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;
}

export class SetProductRateDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  /**
   * Rate per kilogram in integer paise (e.g., 2550 paise for Rs 25.50/kg).
   */
  @IsNotEmpty()
  @IsInt()
  @Min(1, { message: 'Rate must be a positive integer in paise' })
  ratePerKg: number;

  @IsOptional()
  @IsNumber()
  marketBenchmarkRate?: number;

  @IsOptional()
  @IsNumber()
  marginDelta?: number;

  @IsOptional()
  @IsString()
  marginType?: string;
}

export class CreateTimeSlotDto {
  @IsNotEmpty()
  @IsString()
  startTime: string;

  @IsNotEmpty()
  @IsString()
  endTime: string;

  @IsNotEmpty()
  @IsString()
  displayLabel: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxPickups?: number;

  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

export class CreateWeightRangeDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  displayLabel: string;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  minGrams: number;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  maxGrams: number;

  @IsOptional()
  @IsInt()
  displayOrder?: number;
}
