import { Injectable, Logger } from '@nestjs/common';

export interface FeedRateItem {
  /** Optional. When absent the code is derived from the name. */
  code?: string;
  name: string;
  /** Optional category name, used only for items not already known. */
  category?: string;
  /** Rupees per kg. */
  ratePerKg: number;
}

/**
 * Optional live feed. There is no public, licensed API for Indian scrap (kabadi)
 * rates, so this stays disabled until you point it at a source you are allowed to
 * use (a paid data vendor, a partner, or your own small proxy service):
 *
 *   MARKET_RATES_FEED_URL=https://example.com/vijayawada-rates.json
 *   MARKET_RATES_FEED_API_KEY=...                 (optional)
 *   MARKET_RATES_FEED_KEY_HEADER=x-api-key        (optional, default x-api-key)
 *
 * Expected response: either an array or `{ "items": [...] }` of
 *   { "code": "COPPER", "name": "Copper", "category": "Metal", "ratePerKg": 563.81 }
 */
@Injectable()
export class MarketRateFeedProvider {
  private readonly logger = new Logger(MarketRateFeedProvider.name);

  isConfigured(): boolean {
    return Boolean(process.env.MARKET_RATES_FEED_URL);
  }

  async fetchRates(): Promise<FeedRateItem[]> {
    const url = process.env.MARKET_RATES_FEED_URL;
    if (!url) return [];

    const headers: Record<string, string> = { Accept: 'application/json' };
    const apiKey = process.env.MARKET_RATES_FEED_API_KEY;
    if (apiKey) {
      headers[process.env.MARKET_RATES_FEED_KEY_HEADER || 'x-api-key'] = apiKey;
    }

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`Market rate feed responded HTTP ${response.status}`);
    }
    const json: any = await response.json();
    const rows: any[] = Array.isArray(json) ? json : Array.isArray(json?.items) ? json.items : [];

    const items: FeedRateItem[] = [];
    for (const row of rows) {
      const ratePerKg = Number(row?.ratePerKg);
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      if (!name || !Number.isFinite(ratePerKg) || ratePerKg <= 0) {
        this.logger.warn(`Skipping invalid feed row: ${JSON.stringify(row)?.slice(0, 120)}`);
        continue;
      }
      items.push({
        code: typeof row.code === 'string' ? row.code : undefined,
        name,
        category: typeof row.category === 'string' ? row.category : undefined,
        ratePerKg,
      });
    }
    return items;
  }
}
