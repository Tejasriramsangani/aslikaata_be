import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { MarketRate, MarketRateDocument } from './schemas/market-rate.schema.js';
import { MarketRateFeedProvider } from './providers/market-rate-feed.provider.js';
import {
  CatalogService,
  DEFAULT_CATALOG_SEED,
  SYSTEM_USER_ID,
} from '../catalog/catalog.service.js';
import { ScrapCategory, ScrapCategoryDocument } from '../catalog/schemas/scrap-category.schema.js';
import { ScrapProduct, ScrapProductDocument } from '../catalog/schemas/scrap-product.schema.js';
import { ScrapRate, ScrapRateDocument } from '../catalog/schemas/scrap-rate.schema.js';

export const MARKET = { key: 'VIJAYAWADA', label: 'Vijayawada, Andhra Pradesh' } as const;

const DEFAULT_DISCOUNT_PERCENT = 10;
/** Never publish a customer rate below ₹0.50/kg. */
const MIN_RATE_PAISE = 50;

/** Common scrap items beyond the default catalog. Rate 0 = admin must set it first. */
const EXTRA_MARKET_ITEMS: Array<{
  code: string;
  name: string;
  categoryCode: string;
  categoryName: string;
}> = [
  { code: 'CAR_BODY', name: 'Car Body / MS Scrap', categoryCode: 'METAL', categoryName: 'Metal' },
  { code: 'RADIATOR', name: 'Radiator (Copper/Brass)', categoryCode: 'METAL', categoryName: 'Metal' },
  { code: 'AC_COMPRESSOR', name: 'AC Compressor', categoryCode: 'METAL', categoryName: 'Metal' },
  { code: 'TIN', name: 'Tin', categoryCode: 'METAL', categoryName: 'Metal' },
  { code: 'CATALYTIC_CONVERTER', name: 'Catalytic Converter', categoryCode: 'METAL', categoryName: 'Metal' },
  { code: 'INVERTER_BATTERY', name: 'Inverter Battery', categoryCode: 'E_WASTE', categoryName: 'E-Waste' },
  { code: 'UPS_BATTERY', name: 'UPS Battery', categoryCode: 'E_WASTE', categoryName: 'E-Waste' },
  { code: 'TWO_WHEELER_BATTERY', name: 'Two Wheeler Battery', categoryCode: 'E_WASTE', categoryName: 'E-Waste' },
  { code: 'LITHIUM_ION_BATTERY', name: 'Lithium Ion Battery', categoryCode: 'E_WASTE', categoryName: 'E-Waste' },
];

const CATEGORY_EMOJI: Record<string, string> = Object.fromEntries(
  DEFAULT_CATALOG_SEED.map((g) => [g.category.code, g.category.emoji]),
);

const toRupees = (paise: number | null | undefined) => Number(((paise || 0) / 100).toFixed(2));
const slugCode = (name: string) =>
  name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** benchmark ± margin. FLAT delta is signed paise; PERCENTAGE delta is a signed percent. */
function priceFromBenchmark(benchmarkPaise: number, marginType: string, delta: number): number {
  const raw = marginType.toUpperCase().startsWith('PERCENT')
    ? benchmarkPaise * (1 + delta / 100)
    : benchmarkPaise + delta;
  return Math.max(MIN_RATE_PAISE, Math.round(raw));
}

function describeMargin(marginType: string, delta: number): string {
  if (!delta) return 'No margin';
  const sign = delta < 0 ? '−' : '+';
  return marginType.toUpperCase().startsWith('PERCENT')
    ? `${sign}${Math.abs(delta).toFixed(1).replace(/\.0$/, '')}%`
    : `${sign}₹${(Math.abs(delta) / 100).toFixed(2)}`;
}

@Injectable()
export class MarketRatesService implements OnModuleInit {
  private readonly logger = new Logger(MarketRatesService.name);
  private lastRefresh: { at: Date; ok: boolean; message: string } | null = null;

  constructor(
    @InjectModel(MarketRate.name) private readonly marketModel: Model<MarketRateDocument>,
    @InjectModel(ScrapCategory.name) private readonly categoryModel: Model<ScrapCategoryDocument>,
    @InjectModel(ScrapProduct.name) private readonly productModel: Model<ScrapProductDocument>,
    @InjectModel(ScrapRate.name) private readonly rateModel: Model<ScrapRateDocument>,
    private readonly catalogService: CatalogService,
    private readonly feed: MarketRateFeedProvider,
  ) {}

  async onModuleInit() {
    try {
      const created = await this.ensureSeed();
      if (created > 0) this.logger.log(`Seeded ${created} ${MARKET.label} market rate rows`);
    } catch (err: any) {
      this.logger.warn(`Market rate seed deferred: ${err.message}`);
    }
  }

  /** Inserts missing rows only; never overwrites rates an admin or feed has set. */
  async ensureSeed(): Promise<number> {
    const seedRows = [
      ...DEFAULT_CATALOG_SEED.flatMap((group) =>
        group.products.map((p) => ({
          code: p.code,
          name: p.name,
          categoryCode: group.category.code,
          categoryName: group.category.name,
          ratePerKgPaise: p.ratePaise,
        })),
      ),
      ...EXTRA_MARKET_ITEMS.map((i) => ({ ...i, ratePerKgPaise: 0 })),
    ];

    let created = 0;
    for (const row of seedRows) {
      const result = await this.marketModel.updateOne(
        { marketKey: MARKET.key, code: row.code },
        { $setOnInsert: { ...row, marketKey: MARKET.key, source: 'SEED', rateUpdatedAt: null } },
        { upsert: true },
      );
      if (result.upsertedCount) created += 1;
    }
    return created;
  }

  // --- Read ---------------------------------------------------------------

  async list(opts: { search?: string; category?: string } = {}) {
    const [rows, products, categories, activeRates] = await Promise.all([
      this.marketModel.find({ marketKey: MARKET.key }).lean(),
      this.productModel.find().lean(),
      this.categoryModel.find().lean(),
      this.rateModel.find({ effectiveTo: null }).lean(),
    ]);

    const productByCode = new Map(products.map((p) => [String(p.code).toUpperCase(), p]));
    const categoryById = new Map(categories.map((c) => [String(c._id), c]));
    const rateByProduct = new Map(activeRates.map((r) => [String(r.productId), r]));

    const q = (opts.search || '').trim().toLowerCase();
    const searched = rows.filter(
      (r) =>
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.categoryName.toLowerCase().includes(q),
    );

    const mapped = searched.map((r) => {
      const product = productByCode.get(r.code);
      const category = product ? categoryById.get(String(product.categoryId)) : undefined;
      const enabled = Boolean(product?.isActive !== false && product && category?.isActive !== false);
      const active = product ? rateByProduct.get(String(product._id)) : undefined;
      const hasBenchmark = Boolean(active?.marketBenchmarkRate && active.marketBenchmarkRate > 0);
      const changePct =
        r.previousRatePerKgPaise > 0 && r.ratePerKgPaise > 0
          ? Number((((r.ratePerKgPaise - r.previousRatePerKgPaise) / r.previousRatePerKgPaise) * 100).toFixed(1))
          : null;

      return {
        id: String(r._id),
        code: r.code,
        name: r.name,
        categoryCode: r.categoryCode,
        categoryName: r.categoryName,
        marketRatePerKg: toRupees(r.ratePerKgPaise),
        previousRatePerKg: r.previousRatePerKgPaise ? toRupees(r.previousRatePerKgPaise) : null,
        changePct,
        source: r.source,
        updatedAt: r.rateUpdatedAt ?? null,
        enabled,
        productId: product ? String(product._id) : null,
        customerRatePerKg: enabled && active ? toRupees(active.ratePerKg) : null,
        margin:
          enabled && active
            ? {
                type: active.marginType || 'FLAT',
                value: active.marginDelta || 0,
                label: hasBenchmark
                  ? describeMargin(active.marginType || 'FLAT', active.marginDelta || 0)
                  : 'Not set',
              }
            : null,
      };
    });

    // Category pills: counts reflect the search, not the category filter.
    const pillMap = new Map<string, { code: string; name: string; count: number; enabledCount: number }>();
    for (const item of mapped) {
      const pill = pillMap.get(item.categoryCode) ?? {
        code: item.categoryCode,
        name: item.categoryName,
        count: 0,
        enabledCount: 0,
      };
      pill.count += 1;
      if (item.enabled) pill.enabledCount += 1;
      pillMap.set(item.categoryCode, pill);
    }

    const filtered = opts.category
      ? mapped.filter((i) => i.categoryCode === opts.category!.toUpperCase())
      : mapped;

    // Enabled items first, then grouped by category, then by name.
    filtered.sort(
      (a, b) =>
        Number(b.enabled) - Number(a.enabled) ||
        a.categoryName.localeCompare(b.categoryName) ||
        a.name.localeCompare(b.name),
    );

    return {
      market: MARKET,
      feed: {
        configured: this.feed.isConfigured(),
        lastRefresh: this.lastRefresh,
      },
      categories: Array.from(pillMap.values()).sort((a, b) => a.name.localeCompare(b.name)),
      totals: {
        items: mapped.length,
        enabled: mapped.filter((i) => i.enabled).length,
      },
      items: filtered,
    };
  }

  // --- Write --------------------------------------------------------------

  async updateRate(id: string, ratePerKgRupees: number, userId: string) {
    const market = await this.getOrThrow(id);
    const paise = Math.round(ratePerKgRupees * 100);
    if (paise !== market.ratePerKgPaise) {
      market.previousRatePerKgPaise = market.ratePerKgPaise;
      market.ratePerKgPaise = paise;
    }
    market.source = 'MANUAL';
    market.rateUpdatedAt = new Date();
    await market.save();

    // Keep the customer-facing rate in step when this item is already live.
    const product = await this.productModel.findOne({ code: market.code });
    if (product?.isActive && paise > 0) {
      await this.applyBenchmark(product, paise, userId, DEFAULT_DISCOUNT_PERCENT);
    }
    return this.itemByCode(market.code);
  }

  async enable(id: string, userId: string, discountPercent?: number) {
    const market = await this.getOrThrow(id);
    if (market.ratePerKgPaise <= 0) {
      throw new BadRequestException(
        `Set a market rate for ${market.name} before enabling it for customers.`,
      );
    }

    const category = await this.ensureCategory(market.categoryCode, market.categoryName);

    let product = await this.productModel.findOne({ code: market.code });
    if (!product) {
      product = await this.productModel.create({
        categoryId: category._id.toString(),
        name: market.name,
        code: market.code,
        isActive: true,
      });
    } else {
      if (!product.isActive) {
        product.isActive = true;
        await product.save();
      }
      // The product may live in a different category than the market row suggests.
      const ownCategory = await this.categoryModel.findById(product.categoryId);
      if (ownCategory && !ownCategory.isActive) {
        ownCategory.isActive = true;
        await ownCategory.save();
      }
    }

    await this.applyBenchmark(
      product,
      market.ratePerKgPaise,
      userId,
      discountPercent ?? DEFAULT_DISCOUNT_PERCENT,
    );
    return this.itemByCode(market.code);
  }

  async disable(id: string) {
    const market = await this.getOrThrow(id);
    const product = await this.productModel.findOne({ code: market.code });
    if (product && product.isActive) {
      product.isActive = false;
      await product.save();
    }
    return this.itemByCode(market.code);
  }

  // --- Live feed ----------------------------------------------------------

  async refreshFromFeed(userId: string) {
    if (!this.feed.isConfigured()) {
      throw new BadRequestException(
        'No live rate feed is configured. Set MARKET_RATES_FEED_URL on the backend, or edit market rates manually.',
      );
    }

    try {
      const items = await this.feed.fetchRates();
      const categories = await this.categoryModel.find().lean();
      let created = 0;
      let updated = 0;
      let repriced = 0;

      for (const item of items) {
        const code = (item.code ? item.code.trim().toUpperCase() : slugCode(item.name)) || slugCode(item.name);
        const paise = Math.round(item.ratePerKg * 100);
        let market = await this.marketModel.findOne({ marketKey: MARKET.key, code });

        if (!market) {
          const wanted = (item.category || '').trim().toLowerCase();
          const cat =
            categories.find((c) => c.name.toLowerCase() === wanted || c.code.toLowerCase() === wanted) ??
            categories.find((c) => c.code === 'OTHERS');
          market = await this.marketModel.create({
            marketKey: MARKET.key,
            code,
            name: item.name,
            categoryCode: cat?.code ?? 'OTHERS',
            categoryName: cat?.name ?? 'Others',
            ratePerKgPaise: paise,
            source: 'FEED',
            rateUpdatedAt: new Date(),
          });
          created += 1;
        } else if (market.ratePerKgPaise !== paise) {
          market.previousRatePerKgPaise = market.ratePerKgPaise;
          market.ratePerKgPaise = paise;
          market.source = 'FEED';
          market.rateUpdatedAt = new Date();
          await market.save();
          updated += 1;
        }

        const product = await this.productModel.findOne({ code });
        if (product?.isActive && (await this.applyBenchmark(product, paise, userId, DEFAULT_DISCOUNT_PERCENT))) {
          repriced += 1;
        }
      }

      const message = `Feed synced: ${items.length} rows, ${created} new, ${updated} changed, ${repriced} customer rates updated`;
      this.lastRefresh = { at: new Date(), ok: true, message };
      this.logger.log(message);
      return { success: true, message, created, updated, repriced };
    } catch (err: any) {
      this.lastRefresh = { at: new Date(), ok: false, message: err.message };
      this.logger.error(`Market rate feed sync failed: ${err.message}`);
      throw new BadRequestException(`Live feed sync failed: ${err.message}`);
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledRefresh() {
    if (!this.feed.isConfigured()) return;
    try {
      await this.refreshFromFeed(SYSTEM_USER_ID);
    } catch {
      // Already logged and recorded in lastRefresh.
    }
  }

  // --- Helpers ------------------------------------------------------------

  private async getOrThrow(id: string): Promise<MarketRateDocument> {
    const market = isValidObjectId(id) ? await this.marketModel.findById(id) : null;
    if (!market) throw new NotFoundException('Market rate not found');
    return market;
  }

  private async itemByCode(code: string) {
    const { items } = await this.list();
    return items.find((i) => i.code === code) ?? null;
  }

  private async ensureCategory(code: string, name: string): Promise<ScrapCategoryDocument> {
    let category = await this.categoryModel.findOne({ code });
    if (!category) {
      const last = await this.categoryModel.findOne().sort({ displayOrder: -1 }).lean();
      category = await this.categoryModel.create({
        name,
        code,
        emoji: CATEGORY_EMOJI[code] || '📦',
        displayOrder: (last?.displayOrder ?? 0) + 1,
        isActive: true,
      });
    } else if (!category.isActive) {
      category.isActive = true;
      await category.save();
    }
    return category;
  }

  /**
   * Re-derives a product's customer rate from a market benchmark (benchmark ± the
   * margin already configured) and publishes it as a new immutable rate row.
   * Returns true when a new rate row was written.
   */
  private async applyBenchmark(
    product: ScrapProductDocument,
    benchmarkPaise: number,
    userId: string,
    discountPercent: number,
  ): Promise<boolean> {
    const active = await this.rateModel
      .findOne({ productId: product._id.toString(), effectiveTo: null })
      .sort({ effectiveFrom: -1 });

    let marginType: string;
    let delta: number;
    let ratePaise: number;

    if (active && (active.marketBenchmarkRate ?? 0) > 0) {
      marginType = active.marginType || 'FLAT';
      delta = active.marginDelta ?? 0;
      ratePaise = priceFromBenchmark(benchmarkPaise, marginType, delta);
      if (active.ratePerKg === ratePaise && active.marketBenchmarkRate === benchmarkPaise) return false;
    } else if (active) {
      // A customer rate exists but no benchmark was ever recorded: keep the price
      // customers see today and store the gap as a flat margin.
      marginType = 'FLAT';
      delta = active.ratePerKg - benchmarkPaise;
      ratePaise = active.ratePerKg;
    } else {
      marginType = 'PERCENTAGE';
      delta = -Math.abs(discountPercent);
      ratePaise = priceFromBenchmark(benchmarkPaise, marginType, delta);
    }

    await this.catalogService.setProductRate(
      {
        productId: product._id.toString(),
        ratePerKg: ratePaise,
        marketBenchmarkRate: benchmarkPaise,
        marginDelta: delta,
        marginType,
      },
      isValidObjectId(userId) ? userId : SYSTEM_USER_ID,
    );
    return true;
  }
}
