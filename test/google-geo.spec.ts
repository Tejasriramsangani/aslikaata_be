import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleGeoService } from '../src/modules/geo/google-geo.service.js';

afterEach(() => vi.unstubAllEnvs());
const components = [
  { longText: 'Benz Circle', types: ['sublocality_level_1'] },
  { longText: 'Vijayawada', types: ['locality'] },
  { longText: 'Andhra Pradesh', types: ['administrative_area_level_1'] },
  { longText: '520010', types: ['postal_code'] },
];
const configured = (body: unknown, ok = true) => {
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-server-key');
  const fetch = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 403,
    json: async () => body,
  }));
  return { service: new GoogleGeoService(fetch), fetch };
};
describe('Google location integration', () => {
  it('prefers neighborhood detail over the suburb-only label in the screenshot case', async () => {
    const { service, fetch } = configured({
      status: 'OK',
      results: [
        {
          formatted_address: 'Madhura Nagar, Vijayawada, Andhra Pradesh 520001',
          address_components: [
            { long_name: 'Devi Nagar', types: ['sublocality_level_1'] },
            { long_name: 'Madhura Nagar', types: ['neighborhood'] },
            { long_name: 'Vijayawada', types: ['locality'] },
            {
              long_name: 'Andhra Pradesh',
              types: ['administrative_area_level_1'],
            },
            { long_name: '520001', types: ['postal_code'] },
          ],
          geometry: { location: { lat: 16.52, lng: 80.64 } },
        },
      ],
    });
    expect(await service.reverse(16.52549, 80.64954)).toMatchObject({
      areaName: 'Madhura Nagar',
      latitude: 16.52549,
      longitude: 80.64954,
      pincode: '520001',
    });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('latlng')).toBe(
      '16.52549,80.64954',
    );
  });
  it('prefers a street when Google supplies it', async () => {
    const { service } = configured({
      status: 'OK',
      results: [
        {
          formatted_address: 'Test Road, Test Neighborhood',
          address_components: [
            { long_name: 'Broad area', types: ['sublocality_level_1'] },
            { long_name: 'Test Neighborhood', types: ['neighborhood'] },
            { long_name: 'Test Road', types: ['route'] },
          ],
        },
      ],
    });
    expect((await service.reverse(16, 80)).areaName).toBe('Test Road');
  });
  it('returns unresolved without fabricating an address on ZERO_RESULTS', async () => {
    const { service } = configured({ status: 'ZERO_RESULTS', results: [] });
    expect(await service.reverse(16, 80)).toMatchObject({
      resolved: false,
      areaName: '',
      latitude: 16,
      longitude: 80,
    });
  });
  it('sanitizes Geocoding API rejection', async () => {
    const { service } = configured({
      status: 'REQUEST_DENIED',
      error_message: 'test-server-key',
    });
    await expect(service.reverse(16, 80)).rejects.toThrow(
      'Geocoding API configuration',
    );
    await expect(service.reverse(16, 80)).rejects.not.toThrow(
      'test-server-key',
    );
  });
  it('validates reverse coordinates before contacting Google', async () => {
    const { service, fetch } = configured({});
    await expect(service.reverse(91, 80)).rejects.toThrow(
      'Invalid coordinates',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it('treats whitespace-only credentials as missing configuration', () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '   ');
    const service = new GoogleGeoService(vi.fn());
    expect(service.getSearchConfig().configured).toBe(false);
    expect(service.getMapConfig().configured).toBe(false);
  });
  it('sanitizes provider error bodies even when HTTP status is successful', async () => {
    const { service } = configured({ error: { message: 'test-server-key' } });
    await expect(service.search('benz', 'session')).rejects.toThrow(
      'Google location service is unavailable',
    );
    await expect(service.search('benz', 'session')).rejects.not.toThrow(
      'test-server-key',
    );
  });
  it('rejects malformed prediction collections safely', async () => {
    const { service } = configured({ suggestions: 'invalid' });
    await expect(service.search('benz', 'session')).rejects.toThrow(
      'invalid response',
    );
  });
  it('rejects missing Place Details coordinates instead of fabricating a location', async () => {
    const { service } = configured({
      formattedAddress: 'Incomplete provider response',
    });
    await expect(service.details('place-1', 'session')).rejects.toThrow(
      'invalid coordinates',
    );
  });
  it('aborts timed-out provider requests without returning their raw errors', async () => {
    vi.useFakeTimers();
    vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-server-key');
    const service = new GoogleGeoService(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('test-server-key')),
          );
        }),
    );
    try {
      const checked = expect(service.search('benz', 'session')).rejects.toThrow(
        'Google location service is unavailable',
      );
      await vi.advanceTimersByTimeAsync(8000);
      await checked;
    } finally {
      vi.useRealTimers();
    }
  });
  it('does not request any provider when the server credential is missing', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    const fetch = vi.fn();
    const service = new GoogleGeoService(fetch);
    await expect(service.search('benz')).rejects.toThrow('not configured');
    expect(fetch).not.toHaveBeenCalled();
    expect(service.getMapConfig()).not.toHaveProperty('apiKey');
    expect(service.getSearchConfig().configured).toBe(false);
  });
  it('uses autocomplete with a session, field mask and geographic bias without hard restricting searches', async () => {
    const { service, fetch } = configured({
      suggestions: [
        {
          placePrediction: {
            placeId: 'place-1',
            text: { text: 'Benz Circle, Vijayawada' },
            structuredFormat: { mainText: { text: 'Benz Circle' } },
          },
        },
      ],
    });
    expect(await service.search('ben', 'session', 17.4, 78.4)).toEqual([
      {
        placeId: 'place-1',
        areaName: 'Benz Circle',
        label: 'Benz Circle, Vijayawada',
      },
    ]);
    const [url, options] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    const body = JSON.parse(String(options.body));
    expect(body).toMatchObject({
      sessionToken: 'session',
      locationBias: { circle: { center: { latitude: 17.4, longitude: 78.4 } } },
    });
    expect(body.locationRestriction).toBeUndefined();
    expect(body.includedRegionCodes).toBeUndefined();
    expect(options.headers).toHaveProperty('X-Goog-FieldMask');
  });
  it('resolves selected predictions through Place Details using the same session token', async () => {
    const { service, fetch } = configured({
      location: { latitude: 16.5, longitude: 80.6 },
      addressComponents: components,
      formattedAddress: 'Benz Circle, Vijayawada 520010',
    });
    expect(await service.details('place-1', 'session')).toMatchObject({
      latitude: 16.5,
      longitude: 80.6,
      pincode: '520010',
      city: 'Vijayawada',
    });
    expect(fetch.mock.calls[0][0]).toContain('sessionToken=session');
  });
  it('keeps missing postal data empty', () => {
    const { service } = configured({});
    expect(
      service.toPlace(
        components.filter((c) => !c.types.includes('postal_code')),
        'Address',
        1,
        2,
      ).pincode,
    ).toBe('');
  });
  it('handles Google API denial without revealing credentials or provider error content', async () => {
    const { service } = configured(
      { error: { message: 'test-server-key' } },
      false,
    );
    await expect(service.search('benz')).rejects.toThrow(
      'Google location service is unavailable',
    );
    await expect(service.search('benz')).rejects.not.toThrow('test-server-key');
  });
  it('validates coordinates and identifiers before making billable requests', async () => {
    const { service, fetch } = configured({});
    await expect(service.search('benz', 'session', 91, 1)).rejects.toThrow(
      'Invalid coordinates',
    );
    await expect(service.details('../unsafe')).rejects.toThrow(
      'Invalid place identifier',
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
