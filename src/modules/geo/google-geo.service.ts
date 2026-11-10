import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface ResolvedPlace {
  resolved: boolean;
  latitude: number;
  longitude: number;
  areaName: string;
  city: string;
  state: string;
  pincode: string;
  formattedAddress: string;
}
export interface GooglePlaceMatch {
  placeId: string;
  areaName: string;
  label: string;
}
export interface GoogleMapConfig {
  provider: 'google';
  configured: boolean;
  mapId?: string;
}
type FetchLike = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

/** Google web-service credentials stay on the backend. Places content is not persistently cached. */
@Injectable()
export class GoogleGeoService {
  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}
  private key(): string {
    const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!key)
      throw new ServiceUnavailableException(
        'Google location service is not configured',
      );
    return key;
  }
  getMapConfig(): GoogleMapConfig {
    return {
      provider: 'google',
      configured: !!process.env.GOOGLE_MAPS_API_KEY?.trim(),
      mapId: process.env.GOOGLE_MAPS_MAP_ID || undefined,
    };
  }
  getSearchConfig() {
    return {
      autocomplete: true,
      minimumCharacters: 2,
      provider: 'google',
      configured: !!process.env.GOOGLE_MAPS_API_KEY?.trim(),
    };
  }
  private coordinates(latitude: number, longitude: number) {
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      throw new BadRequestException('Invalid coordinates');
  }
  private async json(url: string, init: RequestInit = {}): Promise<any> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: abort.signal,
      });
      if (!response.ok) throw new Error('Provider rejected request');
      const body = await response.json();
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        body.error
      )
        throw new Error('Invalid provider response');
      return body;
    } catch {
      // Do not log provider URLs, headers or raw errors: these may contain credentials.
      throw new ServiceUnavailableException(
        'Google location service is unavailable. Check enabled APIs, billing and credential restrictions.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
  async search(
    query: string,
    sessionToken?: string,
    latitude?: number,
    longitude?: number,
  ): Promise<GooglePlaceMatch[]> {
    const input = query.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (input.length < 2) return [];
    const key = this.key();
    const center =
      latitude != null && longitude != null
        ? { latitude, longitude }
        : {
            latitude: Number(process.env.GOOGLE_MAPS_BIAS_LAT || 16.5062),
            longitude: Number(process.env.GOOGLE_MAPS_BIAS_LNG || 80.648),
          };
    this.coordinates(center.latitude, center.longitude);
    const body = await this.json(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask':
            'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
        },
        body: JSON.stringify({
          input,
          sessionToken,
          languageCode: 'en',
          regionCode: 'in',
          locationBias: { circle: { center, radius: 50000 } },
        }),
      },
    );
    if (body.suggestions != null && !Array.isArray(body.suggestions))
      throw new ServiceUnavailableException(
        'Google location service returned an invalid response',
      );
    return (body.suggestions || []).flatMap((item: any) => {
      const p = item?.placePrediction;
      return typeof p?.placeId === 'string' &&
        /^[A-Za-z0-9_-]{1,255}$/.test(p.placeId)
        ? [
            {
              placeId: p.placeId,
              areaName: String(
                p.structuredFormat?.mainText?.text || p.text?.text || '',
              ),
              label: String(p.text?.text || ''),
            },
          ]
        : [];
    });
  }
  async details(
    placeId: string,
    sessionToken?: string,
  ): Promise<ResolvedPlace> {
    if (!/^[A-Za-z0-9_-]{1,255}$/.test(placeId))
      throw new BadRequestException('Invalid place identifier');
    const url = new URL(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    );
    if (sessionToken) url.searchParams.set('sessionToken', sessionToken);
    url.searchParams.set('languageCode', 'en');
    const body = await this.json(url.toString(), {
      headers: {
        'X-Goog-Api-Key': this.key(),
        'X-Goog-FieldMask': 'id,location,formattedAddress,addressComponents',
      },
    });
    const latitude = body.location?.latitude,
      longitude = body.location?.longitude;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      throw new ServiceUnavailableException(
        'Google Place Details returned invalid coordinates',
      );
    return this.toPlace(
      Array.isArray(body.addressComponents) ? body.addressComponents : [],
      typeof body.formattedAddress === 'string' ? body.formattedAddress : '',
      latitude,
      longitude,
    );
  }
  /** Resolve the pin with Google while retaining the exact requested coordinates. */
  async reverse(latitude: number, longitude: number): Promise<ResolvedPlace> {
    this.coordinates(latitude, longitude);
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${latitude},${longitude}`);
    url.searchParams.set('language', 'en');
    url.searchParams.set('key', this.key());
    const body = await this.json(url.toString());
    if (body.status === 'ZERO_RESULTS')
      return this.toPlace([], '', latitude, longitude, true);
    if (body.status !== 'OK' || !Array.isArray(body.results))
      throw new ServiceUnavailableException(
        'Google address lookup is unavailable. Check Geocoding API configuration.',
      );
    const result = body.results[0];
    return this.toPlace(
      Array.isArray(result?.address_components)
        ? result.address_components
        : [],
      typeof result?.formatted_address === 'string'
        ? result.formatted_address
        : '',
      latitude,
      longitude,
      true,
    );
  }

  /** Prefer street/neighborhood detail only for the new map's reverse lookup. */
  toPlace(
    components: any[] = [],
    formattedAddress = '',
    latitude: number,
    longitude: number,
    preferPrecise = false,
  ): ResolvedPlace {
    const field = (...types: string[]) => {
      for (const type of types) {
        const c = components.find(
          (item) => Array.isArray(item?.types) && item.types.includes(type),
        );
        if (c) return String(c.longText || c.long_name || '');
      }
      return '';
    };
    const city = field(
      'locality',
      'postal_town',
      'administrative_area_level_3',
      'administrative_area_level_2',
    );
    const areaName =
      (preferPrecise
        ? field(
            'route',
            'neighborhood',
            'sublocality_level_3',
            'sublocality_level_2',
            'sublocality_level_1',
            'sublocality',
          )
        : field(
            'sublocality_level_1',
            'sublocality',
            'neighborhood',
            'route',
          )) || city;
    const postal = field('postal_code');
    return {
      resolved: !!formattedAddress,
      latitude,
      longitude,
      areaName,
      city,
      state: field('administrative_area_level_1'),
      pincode: /^\d{6}$/.test(postal) ? postal : '',
      formattedAddress,
    };
  }
}
