import 'reflect-metadata';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { GeoModule } from '../src/modules/geo/geo.module.js';
import { GeoService } from '../src/modules/geo/geo.service.js';
import { GoogleGeoService } from '../src/modules/geo/google-geo.service.js';
import { GeoController } from '../src/modules/geo/geo.controller.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { ApiResponseInterceptor } from '../src/common/interceptors/api-response.interceptor.js';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter.js';

const sessionToken = '123e4567-e89b-42d3-a456-426614174000';
const address = {
  resolved: true,
  latitude: 16.5,
  longitude: 80.6,
  areaName: 'Test locality',
  city: 'Vijayawada',
  state: 'Andhra Pradesh',
  pincode: '520010',
  formattedAddress: 'Test locality, Vijayawada 520010',
};
let app: INestApplication;
let legacy: GeoService;
let google: GoogleGeoService;
let providerFailure = false;
const provider = vi.fn(async (url: string, _options?: RequestInit) => ({
  ok: !providerFailure,
  status: providerFailure ? 403 : 200,
  json: async () =>
    url.includes('/maps/api/geocode/json')
      ? {
          status: 'OK',
          results: [
            {
              formatted_address: 'Test Road, Vijayawada 520010',
              address_components: [
                { long_name: 'Test Road', types: ['route'] },
                { long_name: address.city, types: ['locality'] },
                {
                  long_name: address.state,
                  types: ['administrative_area_level_1'],
                },
                { long_name: address.pincode, types: ['postal_code'] },
              ],
            },
          ],
        }
      : url.includes(':autocomplete')
        ? {
            suggestions: [
              {
                placePrediction: {
                  placeId: 'test-place',
                  text: { text: address.formattedAddress },
                  structuredFormat: { mainText: { text: address.areaName } },
                },
              },
            ],
          }
        : {
            location: {
              latitude: address.latitude,
              longitude: address.longitude,
            },
            formattedAddress: address.formattedAddress,
            addressComponents: [
              { longText: address.city, types: ['locality'] },
              {
                longText: address.state,
                types: ['administrative_area_level_1'],
              },
              { longText: address.pincode, types: ['postal_code'] },
            ],
          },
}));

beforeAll(async () => {
  // Only GeoModule is initialized: no MongoDB, seed hooks, workers or notifications.
  vi.stubGlobal('fetch', provider);
  vi.stubEnv('MAP_TILE_URL', 'https://tiles.example.invalid/{z}/{x}/{y}.png');
  vi.stubEnv('MAP_TILE_ATTRIBUTION', 'Test attribution');
  vi.stubEnv('MAP_MAX_ZOOM', '18');
  app = await NestFactory.create(GeoModule, { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  legacy = app.get(GeoService);
  google = app.get(GoogleGeoService);
});
beforeEach(() => {
  vi.restoreAllMocks();
  provider.mockClear();
  providerFailure = false;
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'synthetic-private-key');
});
afterAll(async () => {
  await app?.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('additive geo HTTP compatibility', () => {
  it('exposes Google reverse without invoking or changing legacy reverse', async () => {
    const old = vi.spyOn(legacy, 'reverse');
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/google-reverse')
      .query({ lat: 16.52549, lng: 80.64954 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      areaName: 'Test Road',
      latitude: 16.52549,
      longitude: 80.64954,
    });
    expect(old).not.toHaveBeenCalled();
    expect(JSON.stringify(r.body)).not.toContain('synthetic-private-key');
  });
  it('fails Google reverse safely with a missing credential', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/google-reverse')
      .query({ lat: 16, lng: 80 });
    expect(r.status).toBe(503);
    expect(provider).not.toHaveBeenCalled();
  });
  it('preserves the exact configured Leaflet tile contract', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/geo/map-config');
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({
      tileUrl: 'https://tiles.example.invalid/{z}/{x}/{y}.png',
      attribution: 'Test attribution',
      maxZoom: 18,
    });
    expect(provider).not.toHaveBeenCalled();
  });
  it('routes legacy search to the unchanged service and preserves resolved rows', async () => {
    const old = vi
      .spyOn(legacy, 'search')
      .mockResolvedValue([{ ...address, label: address.formattedAddress }]);
    const modern = vi.spyOn(google, 'search');
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/search')
      .query({ q: 'benz' });
    expect(r.status).toBe(200);
    expect(r.body.data[0]).toMatchObject(address);
    expect(old).toHaveBeenCalledExactlyOnceWith('benz');
    expect(modern).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
  it('keeps the three-character legacy minimum', async () => {
    const old = vi.spyOn(legacy, 'search');
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/search')
      .query({ q: 'be' });
    expect(r.status).toBe(400);
    expect(old).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });
  it('uses Google predictions for an explicit valid session token and two-character query', async () => {
    const old = vi.spyOn(legacy, 'search');
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/search')
      .query({ q: 'be', sessionToken, lat: 16.5, lng: 80.6 });
    expect(r.status).toBe(200);
    expect(r.body.data[0]).toMatchObject({
      placeId: 'test-place',
      areaName: address.areaName,
    });
    expect(r.body.data[0]).not.toHaveProperty('latitude');
    expect(old).not.toHaveBeenCalled();
    const body = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      sessionToken,
      locationBias: { circle: { center: { latitude: 16.5, longitude: 80.6 } } },
    });
  });
  it('returns provider-resolved Place Details with the same session', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/place-details')
      .query({ placeId: 'test-place', sessionToken });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      latitude: address.latitude,
      longitude: address.longitude,
      city: address.city,
      pincode: address.pincode,
    });
    expect(provider.mock.calls[0][0]).toContain('sessionToken=' + sessionToken);
  });
  it('keeps nearby routed exclusively to the legacy service', async () => {
    const rows = [
      {
        name: 'Test school',
        kind: 'school',
        latitude: 16.5,
        longitude: 80.6,
        distanceMeters: 12,
      },
    ];
    const old = vi.spyOn(legacy, 'nearby').mockResolvedValue(rows);
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/nearby')
      .query({ lat: 16.5, lng: 80.6 });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(rows);
    expect(old).toHaveBeenCalledExactlyOnceWith(16.5, 80.6);
    expect(provider).not.toHaveBeenCalled();
  });
  it('keeps reverse routed exclusively to the legacy service', async () => {
    const old = vi.spyOn(legacy, 'reverse').mockResolvedValue(address);
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/reverse')
      .query({ lat: 16.5, lng: 80.6 });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual(address);
    expect(old).toHaveBeenCalledExactlyOnceWith(16.5, 80.6);
    expect(provider).not.toHaveBeenCalled();
  });
  it.each([
    ['/search', { q: 'be', sessionToken: 'invalid' }],
    ['/search', { q: 'be', sessionToken: '' }],
    ['/search', { q: 'b', sessionToken }],
    ['/search', { q: 'be', sessionToken, lat: 91, lng: 0 }],
    ['/search', { q: 'be', sessionToken, lat: 16 }],
    ['/search', { q: 'benz', lat: 16, lng: 80 }],
    ['/search', { q: 'benz', unexpected: 'value' }],
    ['/place-details', {}],
    ['/place-details', { placeId: '../invalid' }],
    ['/place-details', { placeId: 'test-place', sessionToken: 'invalid' }],
    ['/nearby', { lat: 91, lng: 0 }],
    ['/google-reverse', { lat: 91, lng: 0 }],
    ['/google-reverse', {}],
  ])(
    'rejects invalid %s query before provider access',
    async (route, query) => {
      const r = await request(app.getHttpServer())
        .get('/api/v1/geo' + route)
        .query(query);
      expect(r.status).toBe(400);
      expect(provider).not.toHaveBeenCalled();
    },
  );
  it('fails Google requests safely when configuration is missing, without disabling legacy search', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    expect(
      (await request(app.getHttpServer()).get('/api/v1/geo/search-config')).body
        .data.configured,
    ).toBe(false);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/geo/search')
          .query({ q: 'be', sessionToken })
      ).status,
    ).toBe(503);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/geo/place-details')
          .query({ placeId: 'test-place', sessionToken })
      ).status,
    ).toBe(503);
    vi.spyOn(legacy, 'search').mockResolvedValue([
      { ...address, label: address.formattedAddress },
    ]);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/v1/geo/search')
          .query({ q: 'benz' })
      ).status,
    ).toBe(200);
    expect(provider).not.toHaveBeenCalled();
  });
  it('returns sanitized 503 on Google rejection', async () => {
    providerFailure = true;
    const r = await request(app.getHttpServer())
      .get('/api/v1/geo/search')
      .query({ q: 'benz', sessionToken });
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain('synthetic-private-key');
  });
  it('exposes separate public Google configuration without changing Leaflet metadata', async () => {
    const r = await request(app.getHttpServer()).get(
      '/api/v1/geo/google-config',
    );
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ provider: 'google', configured: true });
    expect(JSON.stringify(r.body)).not.toContain('synthetic-private-key');
    expect(provider).not.toHaveBeenCalled();
  });
  it('marks only the intended geo handlers public for the existing JWT guard', () => {
    const guard = new JwtAuthGuard(new Reflector());
    for (const method of [
      'mapConfig',
      'reverse',
      'nearby',
      'search',
      'searchConfig',
      'googleConfig',
      'googleReverse',
      'details',
    ] as const) {
      expect(
        guard.canActivate({
          getHandler: () => GeoController.prototype[method],
          getClass: () => GeoController,
        } as never),
      ).toBe(true);
    }
  });
});
