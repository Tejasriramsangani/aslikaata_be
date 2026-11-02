import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { ScrapCategory, ScrapCategoryDocument } from './schemas/scrap-category.schema.js';
import { ScrapProduct, ScrapProductDocument } from './schemas/scrap-product.schema.js';
import { ScrapRate, ScrapRateDocument } from './schemas/scrap-rate.schema.js';
import { TimeSlot, TimeSlotDocument } from './schemas/time-slot.schema.js';
import { WeightRange, WeightRangeDocument } from './schemas/weight-range.schema.js';
import { AppSetting, AppSettingDocument } from '../routing/schemas/app-setting.schema.js';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateProductDto,
  UpdateProductDto,
  SetProductRateDto,
  CreateTimeSlotDto,
  CreateWeightRangeDto,
  UpdateWeightRangeDto,
} from './dto/catalog.dto.js';
import { TransactionRunner } from '../../common/database/transaction-runner.js';

// 0 = every order is slot-booked (customer picks date + slot, admin assigns a picker). Matches AppSettingsService.
const DEFAULT_BULK_LIMIT_KG = 0;
/** Weight ranges starting at this many kg are the "bulk" tier, hidden from customers unless showBulkRanges is on. */
const BULK_RANGE_MIN_KG = 50;

/**
 * ScrapRate.createdById is a required ObjectId. Automated actors (boot seeding,
 * scheduled market-rate sync) have no User document, so they use this fixed id.
 * Passing a non-ObjectId string (e.g. 'system_bootstrap') made every seed rate
 * insert throw a CastError and abort the whole default-catalog seed.
 */
export const SYSTEM_USER_ID = '000000000000000000000001';

export const DEFAULT_CATALOG_SEED: Array<{
  category: { name: string; code: string; displayOrder: number; emoji: string };
  products: Array<{ name: string; code: string; ratePaise: number }>;
}> = [
  {
    category: { name: 'Paper', code: 'PAPER', displayOrder: 1, emoji: '📄' },
    products: [
      { name: 'Newspaper', code: 'NEWSPAPER', ratePaise: 1400 }, // Rs 14.00/kg
      { name: 'Cardboard / Carton', code: 'CARDBOARD', ratePaise: 900 }, // Rs 9.00/kg
      { name: 'White Office Paper', code: 'WHITE_PAPER', ratePaise: 1200 }, // Rs 12.00/kg
      { name: 'Magazines & Books', code: 'MAGAZINES', ratePaise: 1000 }, // Rs 10.00/kg
    ],
  },
  {
    category: { name: 'Metal', code: 'METAL', displayOrder: 2, emoji: '⚙️' },
    products: [
      { name: 'Iron / Loha', code: 'IRON', ratePaise: 2800 }, // Rs 28.00/kg
      { name: 'Copper / Tamba', code: 'COPPER', ratePaise: 65000 }, // Rs 650.00/kg
      { name: 'Brass / Peetal', code: 'BRASS', ratePaise: 42000 }, // Rs 420.00/kg
      { name: 'Aluminium', code: 'ALUMINIUM', ratePaise: 14000 }, // Rs 140.00/kg
      { name: 'Stainless Steel', code: 'STEEL', ratePaise: 4500 }, // Rs 45.00/kg
    ],
  },
  {
    category: { name: 'Plastic', code: 'PLASTIC', displayOrder: 3, emoji: '🍾' },
    products: [
      { name: 'PET Bottles', code: 'PET_BOTTLE', ratePaise: 1500 }, // Rs 15.00/kg
      { name: 'Hard Plastic', code: 'HARD_PLASTIC', ratePaise: 1200 }, // Rs 12.00/kg
      { name: 'Polythene & Soft Plastic', code: 'SOFT_PLASTIC', ratePaise: 600 }, // Rs 6.00/kg
    ],
  },
  {
    category: { name: 'E-Waste', code: 'E_WASTE', displayOrder: 4, emoji: '💻' },
    products: [
      { name: 'E-Waste / Electronics', code: 'ELECTRONICS', ratePaise: 3000 }, // Rs 30.00/kg
      { name: 'Lead Acid Batteries', code: 'BATTERY', ratePaise: 8000 }, // Rs 80.00/kg
    ],
  },
  {
    category: { name: 'Rubber', code: 'RUBBER', displayOrder: 5, emoji: '🛞' },
    products: [
      { name: 'Tyres & Tubes', code: 'TYRES', ratePaise: 500 }, // Rs 5.00/kg
      { name: 'General Rubber', code: 'GEN_RUBBER', ratePaise: 400 }, // Rs 4.00/kg
    ],
  },
  {
    category: { name: 'Others', code: 'OTHERS', displayOrder: 6, emoji: '📦' },
    products: [
      { name: 'Beer / Glass Bottles', code: 'GLASS_BOTTLES', ratePaise: 250 }, // Rs 2.50/kg
      { name: 'Mixed Scrap', code: 'MIXED_SCRAP', ratePaise: 300 }, // Rs 3.00/kg
    ],
  },
];

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectModel(ScrapCategory.name)
    private readonly categoryModel: Model<ScrapCategoryDocument>,
    @InjectModel(ScrapProduct.name)
    private readonly productModel: Model<ScrapProductDocument>,
    @InjectModel(ScrapRate.name)
    private readonly rateModel: Model<ScrapRateDocument>,
    @InjectModel(TimeSlot.name)
    private readonly slotModel: Model<TimeSlotDocument>,
    @InjectModel(WeightRange.name)
    private readonly weightRangeModel: Model<WeightRangeDocument>,
    @InjectModel(AppSetting.name)
    private readonly appSettingModel: Model<AppSettingDocument>,
    private readonly transactionRunner: TransactionRunner,
  ) {}

  async onModuleInit() {
    try {
      const count = await this.categoryModel.countDocuments();
      if (count === 0) {
        this.logger.log('Catalog empty on boot. Seeding default scrap catalog...');
      } else {
        this.logger.log('Verifying default catalog on boot (top-up missing entries)...');
      }
      const message = await this.ensureDefaultCatalog('system_bootstrap');
      this.logger.log(message);
    } catch (err: any) {
      this.logger.warn(`Catalog auto-seed deferred: ${err.message}`);
    }
  }

  /**
   * Ensures booking weight ranges and time slots exist even when categories
   * were seeded earlier without them (common cause of empty weight step in FE).
   */
  async ensureWeightRangesAndSlots(): Promise<void> {
    // Older insertMany seeds omitted isActive; public list filters isActive:true → empty UI.
    await this.weightRangeModel.updateMany(
      { $or: [{ isActive: { $exists: false } }, { isActive: null }] },
      { $set: { isActive: true } },
    );
    await this.slotModel.updateMany(
      { $or: [{ isActive: { $exists: false } }, { isActive: null }] },
      { $set: { isActive: true } },
    );

    const [rangeCount, slotCount] = await Promise.all([
      this.weightRangeModel.countDocuments(),
      this.slotModel.countDocuments(),
    ]);

    if (rangeCount === 0) {
      const ranges = [
        { name: 'XS', displayLabel: '0 – 10 kg', minGrams: 0, maxGrams: 10000, displayOrder: 1, isActive: true },
        { name: 'SMALL', displayLabel: '10 – 20 kg', minGrams: 10000, maxGrams: 20000, displayOrder: 2, isActive: true },
        { name: 'MEDIUM', displayLabel: '20 – 30 kg', minGrams: 20000, maxGrams: 30000, displayOrder: 3, isActive: true },
        { name: 'LARGE', displayLabel: '30 – 50 kg', minGrams: 30000, maxGrams: 50000, displayOrder: 4, isActive: true },
        { name: 'BULK', displayLabel: '50+ kg', minGrams: 50000, maxGrams: 10000000, displayOrder: 5, isActive: true },
      ];
      await this.weightRangeModel.insertMany(ranges);
      this.logger.log(`Seeded ${ranges.length} default weight ranges`);
    }

    if (slotCount === 0) {
      const slots = [
        { startTime: '09:00', endTime: '11:00', displayLabel: '9:00 AM – 11:00 AM', maxPickups: 15, displayOrder: 1, isActive: true },
        { startTime: '11:00', endTime: '13:00', displayLabel: '11:00 AM – 1:00 PM', maxPickups: 15, displayOrder: 2, isActive: true },
        { startTime: '13:00', endTime: '15:00', displayLabel: '1:00 PM – 3:00 PM', maxPickups: 15, displayOrder: 3, isActive: true },
        { startTime: '15:00', endTime: '17:00', displayLabel: '3:00 PM – 5:00 PM', maxPickups: 15, displayOrder: 4, isActive: true },
        { startTime: '17:00', endTime: '19:00', displayLabel: '5:00 PM – 7:00 PM', maxPickups: 15, displayOrder: 5, isActive: true },
        { startTime: '19:00', endTime: '20:00', displayLabel: '7:00 PM – 8:00 PM', maxPickups: 15, displayOrder: 6, isActive: true },
      ];
      await this.slotModel.insertMany(slots);
      this.logger.log(`Seeded ${slots.length} default time slots`);
    }
  }

  // --- Category Management ---

  async createCategory(dto: CreateCategoryDto): Promise<ScrapCategoryDocument> {
    const existing = await this.categoryModel.findOne({ code: dto.code.toUpperCase() });
    if (existing) {
      throw new BadRequestException(`Category with code ${dto.code} already exists`);
    }

    return this.categoryModel.create({
      name: dto.name,
      code: dto.code.toUpperCase(),
      iconUrl: dto.iconUrl || null,
      emoji: dto.emoji || '',
      displayOrder: dto.displayOrder || 0,
      isActive: true,
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto): Promise<ScrapCategoryDocument> {
    const category = await this.categoryModel.findById(id);
    if (!category) throw new NotFoundException('Category not found');
    if (dto.name !== undefined) category.name = dto.name;
    if (dto.iconUrl !== undefined) category.iconUrl = dto.iconUrl || null;
    if (dto.emoji !== undefined) category.emoji = dto.emoji;
    if (dto.displayOrder !== undefined) category.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) category.isActive = dto.isActive;
    await category.save();
    return category;
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ScrapProductDocument> {
    const product = await this.productModel.findById(id);
    if (!product) throw new NotFoundException('Product not found');
    if (dto.name !== undefined) product.name = dto.name;
    if (dto.description !== undefined) product.description = dto.description;
    if (dto.imageUrl !== undefined) product.imageUrl = dto.imageUrl || null;
    if (dto.emoji !== undefined) product.emoji = dto.emoji;
    if (dto.isActive !== undefined) product.isActive = dto.isActive;
    await product.save();
    return product;
  }

  async listCategories(activeOnly: boolean = true): Promise<ScrapCategoryDocument[]> {
    const filter = activeOnly ? { isActive: true } : {};
    return this.categoryModel.find(filter).sort({ displayOrder: 1, name: 1 });
  }

  // --- Product Management ---

  async createProduct(dto: CreateProductDto): Promise<ScrapProductDocument> {
    const category = await this.categoryModel.findById(dto.categoryId);
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const existing = await this.productModel.findOne({ code: dto.code.toUpperCase() });
    if (existing) {
      throw new BadRequestException(`Product with code ${dto.code} already exists`);
    }

    return this.productModel.create({
      categoryId: dto.categoryId,
      name: dto.name,
      code: dto.code.toUpperCase(),
      description: dto.description || '',
      imageUrl: dto.imageUrl || null,
      isActive: true,
    });
  }

  async listProducts(categoryId?: string, activeOnly: boolean = true): Promise<ScrapProductDocument[]> {
    const filter: Record<string, any> = activeOnly ? { isActive: true } : {};
    if (categoryId) {
      filter.categoryId = categoryId;
    }
    return this.productModel.find(filter).sort({ name: 1 });
  }

  // --- Immutable Rate Engine (Rule 5.4) ---

  /**
   * Sets a new rate for a product according to Rule 5.4.
   * Rates are immutable. This never edits or deletes an existing row.
   * Closes the active rate by setting effectiveTo = now, and creates a new rate row.
   */
  async setProductRate(
    dto: SetProductRateDto,
    adminUserId: string,
  ): Promise<ScrapRateDocument> {
    const product = await this.productModel.findById(dto.productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const now = new Date();

    return this.transactionRunner.runInTransaction(async (session) => {
      // Find currently active rate
      const activeRate = await this.rateModel.findOne(
        {
          productId: dto.productId,
          effectiveTo: null,
        },
        null,
        { session },
      );

      if (activeRate) {
        activeRate.effectiveTo = now;
        await activeRate.save({ session });
      }

      const [newRate] = await this.rateModel.create(
        [
          {
            productId: dto.productId,
            ratePerKg: dto.ratePerKg,
            marketBenchmarkRate: dto.marketBenchmarkRate,
            marginDelta: dto.marginDelta,
            marginType: dto.marginType,
            effectiveFrom: now,
            effectiveTo: null,
            createdById: adminUserId,
          },
        ],
        { session },
      );

      return newRate;
    });
  }

  /**
   * Returns the currently active rate for a single product.
   */
  async getActiveRateForProduct(productId: string): Promise<ScrapRateDocument> {
    const rate = await this.rateModel
      .findOne({
        productId,
        effectiveTo: null,
      })
      .sort({ effectiveFrom: -1 });

    if (!rate) {
      throw new NotFoundException(`No active rate configured for product ${productId}`);
    }

    return rate;
  }

  /**
   * Returns all active rates.
   */
  async getActiveRates(): Promise<ScrapRateDocument[]> {
    return this.rateModel.find({ effectiveTo: null });
  }

  /**
   * Returns the complete audit history of all rates ever configured for a product.
   */
  async getRateHistory(productId: string): Promise<ScrapRateDocument[]> {
    return this.rateModel.find({ productId }).sort({ effectiveFrom: -1 });
  }

  // --- Hierarchical Catalog for Public & Client Apps ---

  /**
   * Returns full catalog with categories, products, and their currently active rates.
   */
  async getFullCatalog() {
    const categories = await this.listCategories(true);
    const products = await this.listProducts(undefined, true);
    const activeRates = await this.getActiveRates();

    const rateMap = new Map<string, ScrapRateDocument>();
    for (const rate of activeRates) {
      rateMap.set(rate.productId.toString(), rate);
    }

    return categories.map((cat) => {
      const catProducts = products
        .filter((p) => p.categoryId.toString() === cat._id.toString())
        .map((p) => {
          const rate = rateMap.get(p._id.toString());
          return {
            id: p._id.toString(),
            name: p.name,
            code: p.code,
            description: p.description,
            imageUrl: p.imageUrl,
            emoji: p.emoji || cat.emoji || '',
            activeRate: rate
              ? {
                  id: rate._id.toString(),
                  ratePerKgPaise: rate.ratePerKg,
                  ratePerKgRupees: (rate.ratePerKg / 100).toFixed(2),
                  effectiveFrom: rate.effectiveFrom,
                }
              : null,
          };
        });

      const pricedRates = catProducts
        .map((p) => p.activeRate?.ratePerKgPaise)
        .filter((r): r is number => typeof r === 'number');
      const minRate = pricedRates.length ? Math.min(...pricedRates) : null;

      return {
        id: cat._id.toString(),
        name: cat.name,
        code: cat.code,
        iconUrl: cat.iconUrl,
        emoji: cat.emoji || '',
        // Lowest customer rate (margin already applied) so apps can show "from ₹X/kg".
        startingRatePerKgPaise: minRate,
        startingRatePerKgRupees: minRate != null ? (minRate / 100).toFixed(2) : null,
        products: catProducts,
      };
    });
  }

  /**
   * Admin view of the catalog: every category and product (including hidden
   * ones) with the full active rate record (benchmark, margin, final rate).
   */
  async getAdminCatalog() {
    const [categories, products, activeRates] = await Promise.all([
      this.listCategories(false),
      this.listProducts(undefined, false),
      this.getActiveRates(),
    ]);
    const rateMap = new Map<string, ScrapRateDocument>();
    for (const rate of activeRates) rateMap.set(rate.productId.toString(), rate);

    return categories.map((cat) => ({
      id: cat._id.toString(),
      name: cat.name,
      code: cat.code,
      emoji: cat.emoji || '',
      displayOrder: cat.displayOrder,
      isActive: cat.isActive,
      products: products
        .filter((p) => p.categoryId.toString() === cat._id.toString())
        .map((p) => {
          const rate = rateMap.get(p._id.toString());
          return {
            id: p._id.toString(),
            name: p.name,
            code: p.code,
            description: p.description,
            emoji: p.emoji || '',
            isActive: p.isActive,
            activeRate: rate
              ? {
                  id: rate._id.toString(),
                  ratePerKgPaise: rate.ratePerKg,
                  marketBenchmarkRatePaise: rate.marketBenchmarkRate || 0,
                  marginDeltaPaise: rate.marginDelta || 0,
                  marginType: rate.marginType || 'FLAT',
                  effectiveFrom: rate.effectiveFrom,
                }
              : null,
          };
        }),
    }));
  }

  // --- Time Slots & Weight Ranges ---

  async createTimeSlot(dto: CreateTimeSlotDto): Promise<TimeSlotDocument> {
    return this.slotModel.create({
      startTime: dto.startTime,
      endTime: dto.endTime,
      displayLabel: dto.displayLabel,
      maxPickups: dto.maxPickups || 10,
      displayOrder: dto.displayOrder || 0,
      isActive: true,
    });
  }

  async listTimeSlots(activeOnly: boolean = true): Promise<TimeSlotDocument[]> {
    const filter = activeOnly ? { isActive: true } : {};
    return this.slotModel.find(filter).sort({ displayOrder: 1, startTime: 1 });
  }

  async createWeightRange(dto: CreateWeightRangeDto): Promise<WeightRangeDocument> {
    if (dto.maxGrams <= dto.minGrams) {
      throw new BadRequestException('maxGrams must be greater than minGrams');
    }
    return this.weightRangeModel.create({
      name: dto.name,
      displayLabel: dto.displayLabel,
      minGrams: dto.minGrams,
      maxGrams: dto.maxGrams,
      displayOrder: dto.displayOrder || 0,
      isActive: true,
    });
  }

  async updateWeightRange(id: string, dto: UpdateWeightRangeDto): Promise<WeightRangeDocument> {
    const existing = await this.weightRangeModel.findById(id);
    if (!existing) {
      throw new NotFoundException(`Weight range ${id} not found`);
    }

    const nextMin = dto.minGrams ?? existing.minGrams;
    const nextMax = dto.maxGrams ?? existing.maxGrams;
    if (nextMax <= nextMin) {
      throw new BadRequestException('maxGrams must be greater than minGrams');
    }

    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.displayLabel !== undefined) existing.displayLabel = dto.displayLabel;
    if (dto.minGrams !== undefined) existing.minGrams = dto.minGrams;
    if (dto.maxGrams !== undefined) existing.maxGrams = dto.maxGrams;
    if (dto.displayOrder !== undefined) existing.displayOrder = dto.displayOrder;
    if (dto.isActive !== undefined) existing.isActive = dto.isActive;
    await existing.save();
    return existing;
  }

  async deleteWeightRange(id: string): Promise<{ success: boolean }> {
    const existing = await this.weightRangeModel.findById(id);
    if (!existing) {
      throw new NotFoundException(`Weight range ${id} not found`);
    }
    // Soft-delete so historical pickup snapshots remain valid
    existing.isActive = false;
    await existing.save();
    return { success: true };
  }

  async listWeightRanges(activeOnly: boolean = true): Promise<WeightRangeDocument[]> {
    await this.ensureWeightRangesAndSlots();
    const filter = activeOnly ? { isActive: true } : {};
    return this.weightRangeModel.find(filter).sort({ displayOrder: 1, minGrams: 1 });
  }

  private async getBulkLimitKg(): Promise<number> {
    const setting = await this.appSettingModel.findOne({ key: 'bulkLimitKg' }).lean();
    const value = setting?.value;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BULK_LIMIT_KG;
  }

  /** Bulk-tier ranges stay hidden from the customer app until an admin turns this on. */
  private async getShowBulkRanges(): Promise<boolean> {
    const setting = await this.appSettingModel.findOne({ key: 'showBulkRanges' }).lean();
    return setting?.value === true;
  }

  /**
   * Customer booking payload: ranges + which ones count as bulk
   * (minKg >= admin bulkLimitKg threshold).
   */
  async listCustomerWeightRanges(): Promise<{
    bulkLimitKg: number;
    ranges: Array<Record<string, any>>;
  }> {
    const [allRanges, bulkLimitKg, showBulk] = await Promise.all([
      this.listWeightRanges(true),
      this.getBulkLimitKg(),
      this.getShowBulkRanges(),
    ]);
    const ranges = showBulk ? allRanges : allRanges.filter((r) => (r.minGrams || 0) / 1000 < BULK_RANGE_MIN_KG);

    return {
      bulkLimitKg,
      ranges: ranges.map((r) => {
        const minKg = (r.minGrams || 0) / 1000;
        const maxKg = (r.maxGrams || 0) / 1000;
        const isBulk = minKg >= bulkLimitKg;
        return {
          _id: r._id,
          id: r._id.toString(),
          name: r.name,
          displayLabel: r.displayLabel,
          minGrams: r.minGrams,
          maxGrams: r.maxGrams,
          minKg,
          maxKg,
          displayOrder: r.displayOrder,
          isActive: r.isActive,
          isBulk,
        };
      }),
    };
  }

  // --- Default Seed Utility ---

  /**
   * Completes the default catalog idempotently: creates any missing category,
   * product, or active rate from the seed data, leaving existing rows untouched.
   * Rates follow Rule 5.4 — a rate row is only created when a product has no
   * active rate at all; existing rates are never edited or closed.
   */
  async ensureDefaultCatalog(systemUserId: string): Promise<string> {
    let createdCategories = 0;
    let createdProducts = 0;
    let createdRates = 0;

    for (const group of DEFAULT_CATALOG_SEED) {
      let category = await this.categoryModel.findOne({ code: group.category.code });
      if (!category) {
        category = await this.categoryModel.create({
          ...group.category,
          isActive: true,
        });
        createdCategories += 1;
      } else if (!category.emoji) {
        // Backfill only when empty so admin-chosen emojis are never overwritten.
        category.emoji = group.category.emoji;
        await category.save();
      }

      for (const productSeed of group.products) {
        let product = await this.productModel.findOne({ code: productSeed.code });
        if (!product) {
          product = await this.productModel.create({
            categoryId: category._id.toString(),
            name: productSeed.name,
            code: productSeed.code,
            isActive: true,
          });
          createdProducts += 1;
        }

        const activeRate = await this.rateModel.findOne({
          productId: product._id.toString(),
          effectiveTo: null,
        });
        if (!activeRate) {
          await this.rateModel.create({
            productId: product._id.toString(),
            ratePerKg: productSeed.ratePaise,
            effectiveFrom: new Date(),
            effectiveTo: null,
            createdById: isValidObjectId(systemUserId) ? systemUserId : SYSTEM_USER_ID,
          });
          createdRates += 1;
        }
      }
    }

    await this.ensureWeightRangesAndSlots();

    if (createdCategories === 0 && createdProducts === 0 && createdRates === 0) {
      return 'Default catalog already complete';
    }
    return `Default catalog topped up: ${createdCategories} categories, ${createdProducts} products, ${createdRates} rates created`;
  }

  /**
   * Seeds initial categories, products, rates, slots, and ranges if DB is empty.
   * Kept for the admin "Seed catalog" action — it now completes missing entries
   * instead of refusing when the catalog is partially populated.
   */
  async seedDefaultCatalog(systemUserId: string): Promise<string> {
    return this.ensureDefaultCatalog(systemUserId);
  }
}
