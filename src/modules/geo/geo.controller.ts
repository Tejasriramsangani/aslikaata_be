import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Public } from '../../common/guards/jwt-auth.guard.js';
import { GeoService } from './geo.service.js';

export class ReverseGeocodeQuery {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class SearchPlacesQuery {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  q: string;
}

@Controller('api/v1/geo')
export class GeoController {
  constructor(private readonly geoService: GeoService) {}

  /**
   * Public: the customer app calls this during onboarding, before the customer has logged in,
   * to turn the phone's GPS position into an area / city / state / PIN code.
   */
  @Public()
  @Get('reverse')
  reverse(@Query() query: ReverseGeocodeQuery) {
    return this.geoService.reverse(query.lat, query.lng);
  }

  /** Tile settings for the pickup-location map (from the backend .env). */
  @Public()
  @Get('map-config')
  mapConfig() {
    return this.geoService.getMapConfig();
  }

  /** Named places around a GPS point, to suggest as the pickup landmark. */
  @Public()
  @Get('nearby')
  nearby(@Query() query: ReverseGeocodeQuery) {
    return this.geoService.nearby(query.lat, query.lng);
  }

  /** Address search ("benz circle", "520010") for the add-address screen. */
  @Public()
  @Get('search')
  search(@Query() query: SearchPlacesQuery) {
    return this.geoService.search(query.q);
  }
}
