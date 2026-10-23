import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { ScrapCategory, ScrapCategoryDocument } from './schemas/scrap-category.schema.js';
import { ScrapProduct, ScrapProductDocument } from './schemas/scrap-product.schema.js';
import { ScrapRate, ScrapRateDocument } from './schemas/scrap-rate.schema.js';
import { TimeSlot, TimeSlotDocument } from './schemas/time-slot.schema.js';
import { WeightRange, WeightRangeDocument } from './schemas/weight-range.schema.js';
import {
  CreateCategoryDto,
  CreateProductDto,
  SetProductRateDto,
  CreateTimeSlotDto,
  CreateWeightRangeDto,
} from './dto/catalog.dto.js';
import { TransactionRunner } from '../../common/database/transaction-runner.js';

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
    private readonly transactionRunner: TransactionRunner,
  ) {}

  async onModuleInit() {
    try {
      const count = await this.categoryModel.countDocuments();
      if (count === 0) {
        this.logger.log('Catalog empty on boot. Seeding default scrap catalog...');
        await this.seedDefaultCatalog('system_bootstrap');
        this.logger.log('Default ASLI KAATA Scrap Catalog auto-seeded successfully.');
      }
    } catch (err: any) {
      this.logger.warn(`Catalog auto-seed deferred: ${err.message}`);
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
      displayOrder: dto.displayOrder || 0,
      isActive: true,
    });
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

      return {
        id: cat._id.toString(),
        name: cat.name,
        code: cat.code,
        iconUrl: cat.iconUrl,
        products: catProducts,
      };
    });
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
    return this.weightRangeModel.create({
      name: dto.name,
      displayLabel: dto.displayLabel,
      minGrams: dto.minGrams,
      maxGrams: dto.maxGrams,
      displayOrder: dto.displayOrder || 0,
      isActive: true,
    });
  }

  async listWeightRanges(activeOnly: boolean = true): Promise<WeightRangeDocument[]> {
    const filter = activeOnly ? { isActive: true } : {};
    return this.weightRangeModel.find(filter).sort({ displayOrder: 1, minGrams: 1 });
  }

  // --- Default Seed Utility ---

  /**
   * Seeds initial categories, products, rates, slots, and ranges if DB is empty.
   */
  async seedDefaultCatalog(systemUserId: string): Promise<string> {
    const existingCats = await this.categoryModel.countDocuments();
    if (existingCats > 0) {
      return 'Catalog is already populated';
    }

    this.logger.log('Seeding default ASLI KAATA catalog...');

    // 1. Categories & Products & Rates (in integer paise)
    const seedData = [
      {
        category: { name: 'Paper', code: 'PAPER', displayOrder: 1 },
        products: [
          { name: 'Newspaper', code: 'NEWSPAPER', ratePaise: 1400 }, // Rs 14.00/kg
          { name: 'Cardboard / Carton', code: 'CARDBOARD', ratePaise: 900 }, // Rs 9.00/kg
          { name: 'White Office Paper', code: 'WHITE_PAPER', ratePaise: 1200 }, // Rs 12.00/kg
          { name: 'Magazines & Books', code: 'MAGAZINES', ratePaise: 1000 }, // Rs 10.00/kg
        ],
      },
      {
        category: { name: 'Metal', code: 'METAL', displayOrder: 2 },
        products: [
          { name: 'Iron / Loha', code: 'IRON', ratePaise: 2800 }, // Rs 28.00/kg
          { name: 'Copper / Tamba', code: 'COPPER', ratePaise: 65000 }, // Rs 650.00/kg
          { name: 'Brass / Peetal', code: 'BRASS', ratePaise: 42000 }, // Rs 420.00/kg
          { name: 'Aluminium', code: 'ALUMINIUM', ratePaise: 14000 }, // Rs 140.00/kg
          { name: 'Stainless Steel', code: 'STEEL', ratePaise: 4500 }, // Rs 45.00/kg
        ],
      },
      {
        category: { name: 'Plastic', code: 'PLASTIC', displayOrder: 3 },
        products: [
          { name: 'PET Bottles', code: 'PET_BOTTLE', ratePaise: 1500 }, // Rs 15.00/kg
          { name: 'Hard Plastic', code: 'HARD_PLASTIC', ratePaise: 1200 }, // Rs 12.00/kg
          { name: 'Polythene & Soft Plastic', code: 'SOFT_PLASTIC', ratePaise: 600 }, // Rs 6.00/kg
        ],
      },
      {
        category: { name: 'E-Waste', code: 'E_WASTE', displayOrder: 4 },
        products: [
          { name: 'E-Waste / Electronics', code: 'ELECTRONICS', ratePaise: 3000 }, // Rs 30.00/kg
          { name: 'Lead Acid Batteries', code: 'BATTERY', ratePaise: 8000 }, // Rs 80.00/kg
        ],
      },
      {
        category: { name: 'Rubber', code: 'RUBBER', displayOrder: 5 },
        products: [
          { name: 'Tyres & Tubes', code: 'TYRES', ratePaise: 500 }, // Rs 5.00/kg
          { name: 'General Rubber', code: 'GEN_RUBBER', ratePaise: 400 }, // Rs 4.00/kg
        ],
      },
      {
        category: { name: 'Others', code: 'OTHERS', displayOrder: 6 },
        products: [
          { name: 'Beer / Glass Bottles', code: 'GLASS_BOTTLES', ratePaise: 250 }, // Rs 2.50/kg
          { name: 'Mixed Scrap', code: 'MIXED_SCRAP', ratePaise: 300 }, // Rs 3.00/kg
        ],
      },
    ];

    for (const group of seedData) {
      const cat = await this.categoryModel.create(group.category);
      for (const prod of group.products) {
        const p = await this.productModel.create({
          categoryId: cat._id.toString(),
          name: prod.name,
          code: prod.code,
        });

        await this.rateModel.create({
          productId: p._id.toString(),
          ratePerKg: prod.ratePaise,
          effectiveFrom: new Date(),
          effectiveTo: null,
          createdById: systemUserId,
        });
      }
    }

    // 2. Weight Ranges
    const ranges = [
      { name: 'SMALL', displayLabel: 'Below 20 kg', minGrams: 0, maxGrams: 20000, displayOrder: 1 },
      { name: 'MEDIUM', displayLabel: '20 - 50 kg', minGrams: 20000, maxGrams: 50000, displayOrder: 2 },
      { name: 'LARGE', displayLabel: '50 - 100 kg', minGrams: 50000, maxGrams: 100000, displayOrder: 3 },
      { name: 'COMMERCIAL', displayLabel: '100+ kg', minGrams: 100000, maxGrams: 10000000, displayOrder: 4 },
    ];
    for (const r of ranges) {
      await this.weightRangeModel.create(r);
    }

    // 3. Time Slots
    const slots = [
      { startTime: '09:00', endTime: '12:00', displayLabel: '09:00 AM - 12:00 PM', maxPickups: 15, displayOrder: 1 },
      { startTime: '12:00', endTime: '15:00', displayLabel: '12:00 PM - 03:00 PM', maxPickups: 15, displayOrder: 2 },
      { startTime: '15:00', endTime: '18:00', displayLabel: '03:00 PM - 06:00 PM', maxPickups: 15, displayOrder: 3 },
    ];
    for (const s of slots) {
      await this.slotModel.create(s);
    }

    this.logger.log('Default catalog seeded successfully!');
    return 'Default catalog seeded successfully';
  }
}
