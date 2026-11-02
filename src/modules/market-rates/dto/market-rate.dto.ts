import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdateMarketRateDto {
  /** Market benchmark in rupees per kg, e.g. 36.5 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  ratePerKg: number;
}

export class EnableMarketRateDto {
  /**
   * Discount below the market benchmark used for a NEW product's first customer
   * rate (percent). Ignored when the product already has a margin configured.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(90)
  discountPercent?: number;
}
