import { IsLatitude, IsLongitude, IsNumber, IsOptional } from 'class-validator';

export class LocationUpdateDto {
  @IsLatitude({ message: 'latitude must be a valid latitude coordinate' })
  latitude: number;

  @IsLongitude({ message: 'longitude must be a valid longitude coordinate' })
  longitude: number;

  @IsOptional()
  @IsNumber()
  speed?: number;

  @IsOptional()
  @IsNumber()
  heading?: number;
}
