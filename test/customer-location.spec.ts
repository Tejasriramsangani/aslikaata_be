import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { GeoService } from '../src/modules/geo/geo.service.js';
import { CustomersService } from '../src/modules/customers/customers.service.js';

const NOMINATIM_VIJAYAWADA = {
  address: {
    suburb: 'Satyanarayanapuram',
    city: 'Vijayawada',
    state_district: 'NTR district',
    state: 'Andhra Pradesh',
    postcode: '520 011',
    country: 'India',
  },
};

const okResponse = (body: any) => ({ ok: true, status: 200, json: async () => body });

describe('GeoService: GPS -> address', () => {
  it('turns a GPS fix into area, city, state and a 6-digit PIN', async () => {
    const fetchMock = vi.fn(async () => okResponse(NOMINATIM_VIJAYAWADA));
    const place = await new GeoService(fetchMock as any).reverse(16.5205, 80.6305);

    expect(place).toMatchObject({
      resolved: true,
      areaName: 'Satyanarayanapuram',
      city: 'Vijayawada',
      state: 'Andhra Pradesh',
      pincode: '520011',
      latitude: 16.5205,
      longitude: 80.6305,
    });
    expect(place.formattedAddress).toBe('Satyanarayanapuram, Vijayawada, Andhra Pradesh - 520011');

    const [url, init] = fetchMock.mock.calls[0] as any[];
    expect(url).toContain('lat=16.5205');
    expect(url).toContain('lon=80.6305');
    expect(init.headers['User-Agent']).toBeTruthy();
  });

  it('leaves the PIN empty when the geocoder has none, so the app can fall back', async () => {
    const body = { address: { suburb: 'Somewhere', city: 'Vijayawada', state: 'Andhra Pradesh' } };
    const place = await new GeoService((async () => okResponse(body)) as any).reverse(16.5, 80.6);
    expect(place.resolved).toBe(true);
    expect(place.pincode).toBe('');
  });

  it('reports resolved:false (not an error) when the geocoder is down or finds nothing', async () => {
    const down = new GeoService((async () => {
      throw new Error('network down');
    }) as any);
    expect((await down.reverse(16.5, 80.6)).resolved).toBe(false);

    const http500 = new GeoService((async () => ({ ok: false, status: 500, json: async () => ({}) })) as any);
    expect((await http500.reverse(16.5, 80.6)).resolved).toBe(false);

    const ocean = new GeoService((async () => okResponse({ error: 'Unable to geocode' })) as any);
    expect((await ocean.reverse(0, 0)).resolved).toBe(false);
  });

  it('remembers results for nearby points instead of asking again', async () => {
    const fetchMock = vi.fn(async () => okResponse(NOMINATIM_VIJAYAWADA));
    const service = new GeoService(fetchMock as any);
    await service.reverse(16.52051, 80.63051);
    await service.reverse(16.52052, 80.63052);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache failures, so the next try can succeed', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(okResponse(NOMINATIM_VIJAYAWADA));
    const service = new GeoService(fetchMock as any);
    expect((await service.reverse(16.5, 80.6)).resolved).toBe(false);
    expect((await service.reverse(16.5, 80.6)).resolved).toBe(true);
  });

  it('searches addresses and returns places with coordinates, biased to the service region', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse([
        { lat: '16.5033', lon: '80.6469', display_name: 'Benz Circle, Vijayawada, Andhra Pradesh, India', address: { suburb: 'Benz Circle', city: 'Vijayawada', state: 'Andhra Pradesh', postcode: '520010' } },
        { lat: 'x', lon: '80', display_name: 'broken', address: { city: 'Nowhere' } },
        { lat: '16.1', lon: '80.1', display_name: 'no address', address: {} },
      ]),
    );
    const matches = await new GeoService(fetchMock as any).search('  benz   circle ');

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      areaName: 'Benz Circle',
      city: 'Vijayawada',
      pincode: '520010',
      latitude: 16.5033,
      longitude: 80.6469,
      label: 'Benz Circle, Vijayawada, Andhra Pradesh, India',
    });
    const url = (fetchMock.mock.calls[0] as any[])[0] as string;
    expect(url).toContain('/search?');
    expect(url).toContain('q=benz%20circle');
    expect(url).toContain('countrycodes=in');
    expect(url).toContain('viewbox=');
  });

  it('does not search for very short text, and returns [] when the geocoder is down', async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    const service = new GeoService(fetchMock as any);
    expect(await service.search('be')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    const down = new GeoService((async () => {
      throw new Error('offline');
    }) as any);
    expect(await down.search('benz circle')).toEqual([]);
  });

  describe('map settings from the backend .env', () => {
    const KEYS = ['MAP_TILE_URL', 'MAP_TILE_API_KEY', 'MAP_TILE_ATTRIBUTION', 'MAP_MAX_ZOOM'] as const;
    const withEnv = (values: Partial<Record<(typeof KEYS)[number], string>>) => {
      const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
      KEYS.forEach((k) => delete process.env[k]);
      Object.assign(process.env, values);
      try {
        return new GeoService(vi.fn() as any).getMapConfig();
      } finally {
        KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
      }
    };

    it('uses OpenStreetMap tiles when nothing is configured', () => {
      expect(withEnv({})).toEqual({
        tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: expect.stringContaining('OpenStreetMap'),
        maxZoom: 19,
      });
    });

    it('serves the configured provider, filling in the key and its credit line', () => {
      const config = withEnv({
        MAP_TILE_URL: 'https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={apiKey}',
        MAP_TILE_API_KEY: 'abc 123',
        MAP_TILE_ATTRIBUTION: 'MapTiler',
        MAP_MAX_ZOOM: '18',
      });
      expect(config.tileUrl).toBe('https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abc%20123');
      expect(config.attribution).toBe('MapTiler');
      expect(config.maxZoom).toBe(18);
    });

    it('falls back to OpenStreetMap when the key is missing or the URL is not a tile template', () => {
      const noKey = withEnv({ MAP_TILE_URL: 'https://tiles.example.com/{z}/{x}/{y}.png?key={apiKey}' });
      expect(noKey.tileUrl).toContain('tile.openstreetmap.org');
      expect(noKey.attribution).toContain('OpenStreetMap');

      const badUrl = withEnv({ MAP_TILE_URL: 'javascript:alert(1)' });
      expect(badUrl.tileUrl).toContain('tile.openstreetmap.org');

      const missingTokens = withEnv({ MAP_TILE_URL: 'https://tiles.example.com/static.png' });
      expect(missingTokens.tileUrl).toContain('tile.openstreetmap.org');
    });

    it('ignores an unusable zoom limit', () => {
      expect(withEnv({ MAP_MAX_ZOOM: '99' }).maxZoom).toBe(19);
      expect(withEnv({ MAP_MAX_ZOOM: 'x' }).maxZoom).toBe(19);
    });
  });

  describe('nearby landmarks', () => {
    const overpass = {
      elements: [
        { type: 'node', lat: 16.5034, lon: 80.6470, tags: { name: 'Southern Spice', amenity: 'restaurant' } },
        { type: 'node', lat: 16.5035, lon: 80.6471, tags: { name: 'Sri Venkateswara Temple', amenity: 'place_of_worship' } },
        { type: 'node', lat: 16.5033, lon: 80.64691, tags: { name: 'Public Bench', amenity: 'bench' } },
        { type: 'node', lat: 16.5036, lon: 80.6472, tags: { name: 'Southern Spice', amenity: 'restaurant' } },
        { type: 'way', center: { lat: 16.5040, lon: 80.6475 }, tags: { name: 'Chaitanya Eye Hospital', amenity: 'hospital' } },
        { type: 'node', lat: 16.5038, lon: 80.6473, tags: { name: 'Pranank Electronics', shop: 'yes' } },
        { type: 'node', tags: { name: 'No Position', amenity: 'cafe' } },
      ],
    };

    it('lists distinct, recognisable landmarks nearest first, skipping benches and duplicates', () => {
      const list = new GeoService(vi.fn() as any).toLandmarks(overpass, 16.5033, 80.6469);
      const names = list.map((l) => l.name);

      expect(names).not.toContain('Public Bench');
      expect(names).not.toContain('No Position');
      expect(names.filter((n) => n === 'Southern Spice')).toHaveLength(1);
      expect(list[0].distanceMeters).toBeLessThanOrEqual(list[list.length - 1].distanceMeters + 60);
      expect(list.find((l) => l.name === 'Sri Venkateswara Temple')?.kind).toBe('temple / place of worship');
      expect(list.find((l) => l.name === 'Pranank Electronics')?.kind).toBe('shop');
      expect(list.find((l) => l.name === 'Chaitanya Eye Hospital')).toMatchObject({ kind: 'hospital' });
    });

    it('asks Overpass for named places around the point', async () => {
      const fetchMock = vi.fn(async () => okResponse(overpass));
      const list = await new GeoService(fetchMock as any).nearby(16.5033, 80.6469);

      expect(list.length).toBeGreaterThan(0);
      const [url, init] = fetchMock.mock.calls[0] as any[];
      expect(url).toContain('overpass');
      expect(init.method).toBe('POST');
      expect(String(init.body)).toContain('around%3A250%2C16.5033%2C80.6469');
    });

    it('falls back to the closest named map feature when Overpass is down', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('overpass timeout'))
        .mockResolvedValueOnce(okResponse({ name: 'Benz Circle', type: 'bus_stop' }));
      const list = await new GeoService(fetchMock as any).nearby(16.5033, 80.6469);
      expect(list).toEqual([
        { name: 'Benz Circle', kind: 'bus stop', distanceMeters: 0, latitude: 16.5033, longitude: 80.6469 },
      ]);
    });

    it('returns [] (never an error) when nothing can be found', async () => {
      const down = new GeoService((async () => {
        throw new Error('offline');
      }) as any);
      expect(await down.nearby(16.5, 80.6)).toEqual([]);
    });
  });

  it('rejects impossible coordinates', async () => {
    const service = new GeoService(vi.fn() as any);
    await expect(service.reverse(120, 80)).rejects.toThrow(BadRequestException);
    await expect(service.reverse(Number.NaN, 80)).rejects.toThrow(BadRequestException);
  });
}, 20000);

describe('CustomersService: saved location + addresses', () => {
  const build = (opts: { profile?: any; existingAddress?: any } = {}) => {
    const profileModel: any = {
      findOneAndUpdate: vi.fn(async () => opts.profile ?? null),
    };
    const addressModel: any = {
      findOne: vi.fn(async () => opts.existingAddress ?? null),
      countDocuments: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({})),
      create: vi.fn(async (doc: any) => ({ _id: 'new-address', ...doc })),
    };
    return { service: new CustomersService(profileModel, addressModel), profileModel, addressModel };
  };

  const dto: any = {
    latitude: 16.5205,
    longitude: 80.6305,
    areaName: ' Satyanarayanapuram ',
    city: 'Vijayawada',
    state: 'Andhra Pradesh',
    pincode: '520011',
    formattedAddress: 'Satyanarayanapuram, Vijayawada, Andhra Pradesh - 520011',
    houseNumber: ' Flat 4B ',
    landmark: ' Near Sri Venkateswara Temple ',
  };

  it('stores the latest location, with the house number, on the customer profile', async () => {
    const { service, profileModel } = build({ profile: { userId: 'u1' } });
    const res = await service.saveLocation('u1', dto);

    expect(res.saved).toBe(true);
    const [filter, update, options] = profileModel.findOneAndUpdate.mock.calls[0] as any[];
    expect(filter).toEqual({ userId: 'u1' });
    expect(update.$set.lastLocation).toMatchObject({
      latitude: 16.5205,
      longitude: 80.6305,
      areaName: 'Satyanarayanapuram',
      pincode: '520011',
      houseNumber: 'Flat 4B',
      landmark: 'Near Sri Venkateswara Temple',
    });
    expect(update.$set.lastLocation.updatedAt).toBeInstanceOf(Date);
    // never invents a nameless profile: the app saves again once the name step has created it
    expect(options.upsert).toBeFalsy();
  });

  it('says saved:false while the customer has no profile yet', async () => {
    const { service } = build({ profile: null });
    expect((await service.saveLocation('u1', dto)).saved).toBe(false);
  });

  it('stores the house number on a new address', async () => {
    const { service, addressModel } = build();
    await service.addAddress('u1', {
      line1: 'Satyanarayanapuram, Vijayawada',
      houseNumber: ' 12-3/4 ',
      city: 'Vijayawada',
      state: 'Andhra Pradesh',
      pincode: '520011',
      coordinates: [80.6305, 16.5205],
    } as any);
    expect(addressModel.create.mock.calls[0][0]).toMatchObject({ houseNumber: '12-3/4', pincode: '520011' });
  });

  it('reuses the address for the same door instead of saving a copy', async () => {
    const existing = { _id: 'old-address', houseNumber: '12-3/4' };
    const { service, addressModel } = build({ existingAddress: existing });
    const result = await service.addAddress('u1', {
      line1: 'x',
      houseNumber: '12-3/4',
      city: 'Vijayawada',
      state: 'Andhra Pradesh',
      pincode: '520011',
      coordinates: [80.6305, 16.5205],
    } as any);

    expect(result).toBe(existing);
    expect(addressModel.create).not.toHaveBeenCalled();
    const filter = addressModel.findOne.mock.calls[0][0];
    expect(filter).toMatchObject({ userId: 'u1', pincode: '520011', houseNumber: '12-3/4' });
    expect(filter.location.$near.$maxDistance).toBe(40);
  });

  it('keeps the newest landmark when the same door is saved again', async () => {
    const existing: any = { _id: 'old-address', landmark: 'Old temple', save: vi.fn(async () => undefined) };
    const { service, addressModel } = build({ existingAddress: existing });
    const result: any = await service.addAddress('u1', {
      line1: 'x',
      landmark: ' Near City Hospital ',
      city: 'Vijayawada',
      state: 'Andhra Pradesh',
      pincode: '520011',
      coordinates: [80.6305, 16.5205],
    } as any);

    expect(result.landmark).toBe('Near City Hospital');
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(addressModel.create).not.toHaveBeenCalled();
  });

  it('an address without a house number also matches older saved addresses that lack the field', async () => {
    const { service, addressModel } = build();
    await service.addAddress('u1', {
      line1: 'x',
      city: 'Vijayawada',
      state: 'Andhra Pradesh',
      pincode: '520011',
      coordinates: [80.6305, 16.5205],
    } as any);
    expect(addressModel.findOne.mock.calls[0][0].houseNumber).toEqual({ $in: ['', null] });
  });
});
