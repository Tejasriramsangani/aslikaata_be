import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { MarketRatesService } from '../src/modules/market-rates/market-rates.service.js';

const OID = (n: number) => `64b0f0f0f0f0f0f0f0f0f${String(n).padStart(3, '0')}`;

/**
 * Exercises the enable / re-price rules of MarketRatesService with mocked
 * persistence (no database): benchmark ± margin, never changing the price a
 * customer sees when a benchmark is first recorded, and idempotent re-sync.
 */
describe('MarketRatesService – enable & re-price rules', () => {
  let marketDoc: any;
  let productDoc: any;
  let categoryDoc: any;
  let activeRate: any;
  let setProductRate: ReturnType<typeof vi.fn>;
  let service: MarketRatesService;

  beforeEach(() => {
    marketDoc = {
      _id: OID(1),
      code: 'COPPER',
      name: 'Copper / Tamba',
      categoryCode: 'METAL',
      categoryName: 'Metal',
      ratePerKgPaise: 56000, // ₹560.00
      previousRatePerKgPaise: 0,
      source: 'SEED',
      save: vi.fn().mockResolvedValue(undefined),
    };
    categoryDoc = { _id: OID(2), code: 'METAL', isActive: true, save: vi.fn() };
    productDoc = {
      _id: OID(3),
      code: 'COPPER',
      categoryId: OID(2),
      isActive: false,
      save: vi.fn().mockResolvedValue(undefined),
    };
    activeRate = null;
    setProductRate = vi.fn().mockResolvedValue({});

    const marketModel = { findById: vi.fn(async () => marketDoc) };
    const categoryModel = {
      findOne: vi.fn(async () => categoryDoc),
      findById: vi.fn(async () => categoryDoc),
    };
    const productModel = { findOne: vi.fn(async () => productDoc) };
    const rateModel = {
      findOne: vi.fn(() => ({ sort: vi.fn(async () => activeRate) })),
    };

    service = new MarketRatesService(
      marketModel as any,
      categoryModel as any,
      productModel as any,
      rateModel as any,
      { setProductRate } as any,
      { isConfigured: () => false, fetchRates: vi.fn() } as any,
    );
    vi.spyOn(service, 'list').mockResolvedValue({ items: [{ code: 'COPPER', enabled: true }] } as any);
  });

  it('refuses to enable an item whose market rate is not set', async () => {
    marketDoc.ratePerKgPaise = 0;
    await expect(service.enable(OID(1), OID(9))).rejects.toThrow(BadRequestException);
    expect(setProductRate).not.toHaveBeenCalled();
  });

  it('activates the product and prices a brand-new item at benchmark minus the default 10%', async () => {
    await service.enable(OID(1), OID(9));

    expect(productDoc.isActive).toBe(true);
    expect(setProductRate).toHaveBeenCalledTimes(1);
    const [dto] = setProductRate.mock.calls[0];
    expect(dto).toMatchObject({
      productId: OID(3),
      marketBenchmarkRate: 56000,
      marginType: 'PERCENTAGE',
      marginDelta: -10,
      ratePerKg: 50400, // 560.00 * 0.90
    });
  });

  it('honours a custom discount percent for a new item', async () => {
    await service.enable(OID(1), OID(9), 25);
    expect(setProductRate.mock.calls[0][0]).toMatchObject({ marginDelta: -25, ratePerKg: 42000 });
  });

  it('keeps the existing margin when a benchmark is already recorded (flat −₹5)', async () => {
    activeRate = { ratePerKg: 50000, marketBenchmarkRate: 55000, marginType: 'FLAT', marginDelta: -500 };
    await service.enable(OID(1), OID(9));

    expect(setProductRate.mock.calls[0][0]).toMatchObject({
      marketBenchmarkRate: 56000,
      marginType: 'FLAT',
      marginDelta: -500,
      ratePerKg: 55500, // 560.00 − 5.00
    });
  });

  it('applies a percentage margin to a changed benchmark', async () => {
    activeRate = { ratePerKg: 49500, marketBenchmarkRate: 55000, marginType: 'PERCENTAGE', marginDelta: -10 };
    await service.enable(OID(1), OID(9));
    expect(setProductRate.mock.calls[0][0]).toMatchObject({ ratePerKg: 50400, marginDelta: -10 });
  });

  it('never changes the customer price when a benchmark is first recorded', async () => {
    // Existing product priced at ₹14.00/kg with no benchmark ever stored.
    marketDoc.ratePerKgPaise = 1400;
    activeRate = { ratePerKg: 1400, marketBenchmarkRate: 0, marginType: 'FLAT', marginDelta: 0 };
    await service.enable(OID(1), OID(9));

    expect(setProductRate.mock.calls[0][0]).toMatchObject({
      ratePerKg: 1400,
      marketBenchmarkRate: 1400,
      marginType: 'FLAT',
      marginDelta: 0,
    });
  });

  it('stores the gap as a flat margin when the first benchmark differs from the current price', async () => {
    marketDoc.ratePerKgPaise = 1600;
    activeRate = { ratePerKg: 1400, marketBenchmarkRate: 0 };
    await service.enable(OID(1), OID(9));
    expect(setProductRate.mock.calls[0][0]).toMatchObject({ ratePerKg: 1400, marginDelta: -200 });
  });

  it('does not write a new rate row when nothing changed (idempotent sync)', async () => {
    productDoc.isActive = true;
    activeRate = { ratePerKg: 51000, marketBenchmarkRate: 56000, marginType: 'FLAT', marginDelta: -5000 };
    await service.updateRate(OID(1), 560, OID(9)); // same ₹560.00 benchmark
    expect(setProductRate).not.toHaveBeenCalled();
  });

  it('re-prices a live item when its market rate is edited', async () => {
    productDoc.isActive = true;
    activeRate = { ratePerKg: 51000, marketBenchmarkRate: 56000, marginType: 'FLAT', marginDelta: -5000 };
    await service.updateRate(OID(1), 600, OID(9));

    expect(marketDoc.previousRatePerKgPaise).toBe(56000);
    expect(marketDoc.ratePerKgPaise).toBe(60000);
    expect(marketDoc.source).toBe('MANUAL');
    expect(setProductRate.mock.calls[0][0]).toMatchObject({ marketBenchmarkRate: 60000, ratePerKg: 55000 });
  });

  it('only saves the market rate (no customer re-price) while the item is not enabled', async () => {
    productDoc.isActive = false;
    await service.updateRate(OID(1), 600, OID(9));
    expect(marketDoc.ratePerKgPaise).toBe(60000);
    expect(setProductRate).not.toHaveBeenCalled();
  });

  it('floors a customer rate at ₹0.50/kg', async () => {
    marketDoc.ratePerKgPaise = 60; // ₹0.60 benchmark − 90% would be below the floor
    await service.enable(OID(1), OID(9), 90);
    expect(setProductRate.mock.calls[0][0].ratePerKg).toBe(50);
  });
});
