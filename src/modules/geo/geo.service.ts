import { BadRequestException, Injectable, Logger } from '@nestjs/common';

export interface ResolvedPlace {
  /** false when no address could be found for the coordinates (the app then asks for a manual pick). */
  resolved: boolean;
  latitude: number;
  longitude: number;
  areaName: string;
  city: string;
  state: string;
  /** 6-digit Indian PIN code, or '' when the geocoder did not return one. */
  pincode: string;
  formattedAddress: string;
}

/** One address search hit. */
export interface PlaceMatch extends ResolvedPlace {
  /** Full line to show in the results list, e.g. "Benz Circle, Vijayawada, Andhra Pradesh, India". */
  label: string;
}

/** What the apps need to draw the pickup-location map. */
export interface MapConfig {
  /** Tile URL template with {z}/{x}/{y}; any provider key is already filled in. */
  tileUrl: string;
  /** Credit line the provider requires under the map (HTML, from our own config). */
  attribution: string;
  maxZoom: number;
}

const DEFAULT_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const DEFAULT_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/** A named place near a point, usable as a pickup landmark ("Near Sri Venkateswara Temple"). */
export interface NearbyLandmark {
  name: string;
  /** Plain kind such as "temple", "school", "bank", "petrol pump". */
  kind: string;
  distanceMeters: number;
  latitude: number;
  longitude: number;
}

/** How far around the customer to look for landmarks. */
const LANDMARK_RADIUS_M = 250;
const OVERPASS_TIMEOUT_MS = 8000;

/** Easy-to-recognise places rank ahead of shops when two are about equally close. */
const LANDMARK_KINDS: Record<string, string> = {
  place_of_worship: 'temple / place of worship',
  school: 'school',
  college: 'college',
  university: 'university',
  hospital: 'hospital',
  clinic: 'clinic',
  pharmacy: 'pharmacy',
  bank: 'bank',
  fuel: 'petrol pump',
  bus_station: 'bus stand',
  marketplace: 'market',
  cinema: 'cinema',
  police: 'police station',
  townhall: 'town hall',
  community_centre: 'community hall',
  library: 'library',
  restaurant: 'restaurant',
  cafe: 'cafe',
  fast_food: 'eatery',
  supermarket: 'supermarket',
  mall: 'mall',
  hotel: 'hotel',
  post_office: 'post office',
};
/** Named but useless as a "find me here" landmark. */
const IGNORED_KINDS = new Set(['parking', 'bench', 'waste_basket', 'toilets', 'shelter', 'bicycle_parking', 'atm', 'drinking_water']);

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

const CACHE_LIMIT = 500;
const REQUEST_TIMEOUT_MS = 6000;
/** Nominatim's usage policy: at most one request per second. */
const MIN_GAP_MS = 1100;

/**
 * Turns the phone's GPS coordinates into a postal address (area, city, state, PIN) so a customer who
 * taps "Allow current location" never has to pick their locality by hand.
 *
 * Uses OpenStreetMap Nominatim by default. Point GEOCODER_URL at another Nominatim-compatible server
 * (or a self-hosted one) for production volume. Results are cached per ~10 m cell.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);
  private readonly cache = new Map<string, ResolvedPlace>();
  private readonly searchCache = new Map<string, PlaceMatch[]>();
  private readonly landmarkCache = new Map<string, NearbyLandmark[]>();
  private lastCallAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init) as any) {}

  /**
   * Map settings for the customer app, from the backend .env so the tile provider (and its key) can be
   * changed without rebuilding the app:
   *   MAP_TILE_URL          tile template, e.g. https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key={apiKey}
   *   MAP_TILE_API_KEY      substituted for {apiKey} in the template
   *   MAP_TILE_ATTRIBUTION  credit line shown under the map
   *   MAP_MAX_ZOOM          1-22 (default 19)
   * Falls back to OpenStreetMap's free tiles when nothing usable is configured. Note that a tile key ends
   * up in the user's browser, so restrict it to your domain / app at the provider.
   */
  getMapConfig(): MapConfig {
    let tileUrl = (process.env.MAP_TILE_URL || '').trim();
    const apiKey = (process.env.MAP_TILE_API_KEY || '').trim();

    if (tileUrl.includes('{apiKey}')) {
      if (apiKey) {
        tileUrl = tileUrl.split('{apiKey}').join(encodeURIComponent(apiKey));
      } else {
        this.logger.warn('MAP_TILE_URL needs {apiKey} but MAP_TILE_API_KEY is empty: using OpenStreetMap tiles');
        tileUrl = '';
      }
    }
    if (tileUrl && !(/^https?:\/\//.test(tileUrl) && ['{z}', '{x}', '{y}'].every((token) => tileUrl.includes(token)))) {
      this.logger.warn('MAP_TILE_URL must be an http(s) URL containing {z}, {x} and {y}: using OpenStreetMap tiles');
      tileUrl = '';
    }

    const zoom = Number(process.env.MAP_MAX_ZOOM);
    return {
      tileUrl: tileUrl || DEFAULT_TILE_URL,
      attribution: tileUrl
        ? (process.env.MAP_TILE_ATTRIBUTION || '').trim() || DEFAULT_TILE_ATTRIBUTION
        : DEFAULT_TILE_ATTRIBUTION,
      maxZoom: Number.isInteger(zoom) && zoom >= 1 && zoom <= 22 ? zoom : 19,
    };
  }

  async reverse(latitude: number, longitude: number): Promise<ResolvedPlace> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new BadRequestException('Invalid coordinates');
    }
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const cached = this.cache.get(key);
    if (cached) return { ...cached, latitude, longitude };

    // One lookup at a time, spaced out, so a burst of customers cannot get this server blocked.
    const run = this.queue.then(() => this.lookup(latitude, longitude));
    this.queue = run.catch(() => undefined);
    const place = await run;

    if (place.resolved) {
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, place);
    }
    return place;
  }

  /**
   * Address search for the "add address" screen: places matching what the customer typed, biased
   * towards the service region. Returns [] when nothing matches or the geocoder is unavailable.
   */
  async search(query: string): Promise<PlaceMatch[]> {
    const q = (query || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (q.length < 3) return [];
    const key = q.toLowerCase();
    const cached = this.searchCache.get(key);
    if (cached) return cached;

    const run = this.queue.then(() => this.searchLookup(q));
    this.queue = run.catch(() => undefined);
    const matches = await run;

    if (matches.length > 0) {
      if (this.searchCache.size >= CACHE_LIMIT) this.searchCache.delete(this.searchCache.keys().next().value as string);
      this.searchCache.set(key, matches);
    }
    return matches;
  }

  private async searchLookup(q: string): Promise<PlaceMatch[]> {
    const base = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
    // left,top,right,bottom around Vijayawada / Krishna district: results there rank first (not a hard limit).
    const viewbox = process.env.GEOCODER_VIEWBOX || '79.9,17.2,81.3,15.8';
    const url =
      `${base}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&accept-language=en` +
      `&viewbox=${viewbox}&bounded=0&q=${encodeURIComponent(q)}`;
    const body = await this.getJson(url);
    if (!Array.isArray(body)) return [];

    const matches: PlaceMatch[] = [];
    for (const item of body) {
      const latitude = Number(item?.lat);
      const longitude = Number(item?.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const place = this.toPlace(item, latitude, longitude);
      if (!place) continue;
      // A search hit has its own name ("Benz Circle"); the surrounding suburb is only the fallback.
      const name = String(item.name || '').trim();
      const areaName = name || place.areaName;
      const formattedAddress =
        [areaName, areaName !== place.city ? place.city : '', place.state].filter(Boolean).join(', ') +
        (place.pincode ? ` - ${place.pincode}` : '');
      matches.push({
        ...place,
        areaName,
        formattedAddress,
        label: String(item.display_name || formattedAddress),
      });
    }
    return matches;
  }

  /**
   * Named places around the customer's GPS point (temples, schools, banks, petrol pumps, ...), nearest first,
   * to suggest as the pickup landmark. Uses OpenStreetMap data through an Overpass server (OVERPASS_URL; the
   * free public one is slow at busy times, so use your own or a paid places API for production). When it is
   * unavailable the nearest named map feature from the address lookup is offered instead; never throws.
   */
  async nearby(latitude: number, longitude: number): Promise<NearbyLandmark[]> {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      throw new BadRequestException('Invalid coordinates');
    }
    const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const cached = this.landmarkCache.get(key);
    if (cached) return cached;

    const run = this.queue.then(() => this.nearbyLookup(latitude, longitude));
    this.queue = run.catch(() => undefined);
    const landmarks = await run;

    if (landmarks.length > 0) {
      if (this.landmarkCache.size >= CACHE_LIMIT) this.landmarkCache.delete(this.landmarkCache.keys().next().value as string);
      this.landmarkCache.set(key, landmarks);
    }
    return landmarks;
  }

  private async nearbyLookup(latitude: number, longitude: number): Promise<NearbyLandmark[]> {
    const around = `(around:${LANDMARK_RADIUS_M},${latitude},${longitude})`;
    const query =
      `[out:json][timeout:8];(` +
      ['amenity', 'shop', 'tourism', 'public_transport'].map((tag) => `node${around}["name"]["${tag}"];`).join('') +
      `way${around}["name"]["amenity"];way${around}["name"]["shop"];` +
      `);out center 80;`;
    const url = process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
    const body = await this.getJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
      },
      OVERPASS_TIMEOUT_MS,
    );

    const found = this.toLandmarks(body, latitude, longitude);
    if (found.length > 0) return found;

    // Overpass is down or empty here: the address lookup still names the closest mapped feature.
    const reverse = await this.getJson(
      `${(process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '')}/reverse?format=jsonv2&zoom=18&accept-language=en&lat=${latitude}&lon=${longitude}`,
    );
    const name = String(reverse?.name || '').trim();
    return name
      ? [{ name, kind: String(reverse?.type || 'place').replace(/_/g, ' '), distanceMeters: 0, latitude, longitude }]
      : [];
  }

  /** Overpass response -> a few distinct, recognisable landmarks, nearest first. Exposed for tests. */
  toLandmarks(body: any, latitude: number, longitude: number): NearbyLandmark[] {
    const elements: any[] = Array.isArray(body?.elements) ? body.elements : [];
    const seen = new Set<string>();
    const scored: Array<NearbyLandmark & { score: number }> = [];

    for (const el of elements) {
      const name = String(el?.tags?.name || '').trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      const lat = Number(el.lat ?? el.center?.lat);
      const lon = Number(el.lon ?? el.center?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const rawKind = String(el.tags.amenity || el.tags.shop || el.tags.tourism || el.tags.public_transport || '');
      if (IGNORED_KINDS.has(rawKind)) continue;

      const distanceMeters = Math.round(this.metersBetween(latitude, longitude, lat, lon));
      const known = LANDMARK_KINDS[rawKind];
      seen.add(name.toLowerCase());
      scored.push({
        name,
        // Mappers sometimes tag just "shop=yes": that says nothing useful, so call it a plain shop.
        kind: known || (rawKind === 'yes' ? 'shop' : rawKind.replace(/_/g, ' ')) || 'place',
        distanceMeters,
        latitude: lat,
        longitude: lon,
        score: distanceMeters - (known ? 60 : 0),
      });
    }

    return scored
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map(({ score, ...landmark }) => landmark);
  }

  private metersBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(a));
  }

  /** One polite request: spaced out, time-limited, and never throws (null = unavailable). */
  private async getJson(url: string, init: any = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<any | null> {
    const wait = this.lastCallAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    this.lastCallAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal,
        headers: {
          // Required by Nominatim's usage policy.
          'User-Agent': process.env.GEOCODER_USER_AGENT || 'ASLI-KAATA-backend/1.0',
          Accept: 'application/json',
          ...(init.headers || {}),
        },
      });
      if (!res.ok) {
        this.logger.warn(`Geocoding failed: HTTP ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (error: any) {
      this.logger.warn(`Geocoding unavailable: ${error?.message || error}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async lookup(latitude: number, longitude: number): Promise<ResolvedPlace> {
    const empty: ResolvedPlace = {
      resolved: false,
      latitude,
      longitude,
      areaName: '',
      city: '',
      state: '',
      pincode: '',
      formattedAddress: '',
    };

    const base = (process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org').replace(/\/+$/, '');
    const url = `${base}/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${latitude}&lon=${longitude}`;
    const body = await this.getJson(url);
    return (body && this.toPlace(body, latitude, longitude)) || empty;
  }

  /** Maps a Nominatim response to our shape. Exposed for tests. */
  toPlace(body: any, latitude: number, longitude: number): ResolvedPlace | null {
    const a = body?.address;
    if (!a || typeof a !== 'object') return null;

    const pincode = String(a.postcode || '').replace(/\D/g, '').slice(0, 6);
    const areaName = String(
      a.suburb || a.neighbourhood || a.quarter || a.city_district || a.residential || a.hamlet || a.village || a.road || '',
    ).trim();
    const city = String(a.city || a.town || a.village || a.municipality || a.county || a.state_district || '').trim();
    const state = String(a.state || a.region || '').trim();
    if (!city && !areaName) return null;

    const head = areaName || city;
    const formattedAddress = [head, head !== city ? city : '', state].filter(Boolean).join(', ') + (pincode ? ` - ${pincode}` : '');
    return {
      resolved: true,
      latitude,
      longitude,
      areaName: head,
      city: city || areaName,
      state,
      pincode: pincode.length === 6 ? pincode : '',
      formattedAddress,
    };
  }
}
