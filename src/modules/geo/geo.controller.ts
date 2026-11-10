import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Public } from '../../common/guards/jwt-auth.guard.js';
import { GeoService } from './geo.service.js';
import { GoogleGeoService } from './google-geo.service.js';

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
  @MinLength(2)
  @MaxLength(120)
  q: string;

  @IsOptional()
  @IsUUID('4')
  sessionToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}

export class PlaceDetailsQuery {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,255}$/)
  placeId: string;

  @IsOptional()
  @IsUUID('4')
  sessionToken?: string;
}

@Controller('api/v1/geo')
export class GeoController {
  constructor(
    private readonly geoService: GeoService,
    private readonly googleGeoService: GoogleGeoService,
  ) {}

  /**
   * Public: the customer app calls this during onboarding, before the customer has logged in,
   * to turn the phone's GPS position into an area / city / state / PIN code.
   */
  @Public()
  @Get('reverse')
  reverse(@Query() query: ReverseGeocodeQuery) {
    return this.geoService.reverse(query.lat, query.lng);
  }

  /** Google-map pin lookup; deliberately separate from the legacy reverse contract. */
  @Public()
  @Get('google-reverse')
  googleReverse(@Query() query: ReverseGeocodeQuery) {
    return this.googleGeoService.reverse(query.lat, query.lng);
  }

  /** Tile settings for the pickup-location map (from the backend .env). */
  @Public()
  @Get('map-config')
  mapConfig() {
    return this.geoService.getMapConfig();
  }

  @Public()
  @Get('search-config')
  searchConfig() {
    return this.googleGeoService.getSearchConfig();
  }

  /** Additive Google metadata; the legacy Leaflet map-config is unchanged. */
  @Public()
  @Get('google-config')
  googleConfig() {
    return this.googleGeoService.getMapConfig();
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
    if (!query.sessionToken) {
      // Preserve legacy validation and resolved-coordinate results.
      if (query.q.length < 3)
        throw new BadRequestException(
          'q must be longer than or equal to 3 characters',
        );
      if (query.lat != null || query.lng != null)
        throw new BadRequestException(
          'A Google session token is required for location bias',
        );
      return this.geoService.search(query.q);
    }
    if ((query.lat == null) !== (query.lng == null))
      throw new BadRequestException('lat and lng must be supplied together');
    return this.googleGeoService.search(
      query.q,
      query.sessionToken,
      query.lat,
      query.lng,
    );
  }

  @Public()
  @Get('place-details')
  details(@Query() query: PlaceDetailsQuery) {
    return this.googleGeoService.details(query.placeId, query.sessionToken);
  }
}
