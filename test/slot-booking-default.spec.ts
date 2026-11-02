import { describe, it, expect, vi } from 'vitest';
import { OrderClassificationService } from '../src/modules/routing/services/order-classification.service.js';
import { AppSettingsService, DEFAULT_BULK_LIMIT_KG } from '../src/modules/routing/services/app-settings.service.js';

describe('Slot booking is the default (bulkLimitKg = 0)', () => {
  it('defaults the bulk limit to 0 when nothing is configured', async () => {
    const model: any = { findOne: vi.fn(async () => null) };
    const settings = new AppSettingsService(model);
    expect(DEFAULT_BULK_LIMIT_KG).toBe(0);
    expect(await settings.getBulkLimitKg()).toBe(0);
    expect((await settings.getOrderRules()).bulkLimitKg).toBe(0);
  });

  it('keeps an explicit 0 from the database (0 is not treated as "unset")', async () => {
    const model: any = { findOne: vi.fn(async () => ({ value: 0 })) };
    expect(await new AppSettingsService(model).getBulkLimitKg()).toBe(0);
  });

  it('classifies every weight range as BULK (date + slot flow), including the smallest', async () => {
    const settings: any = { getBulkLimitKg: vi.fn(async () => 0) };
    const svc = new OrderClassificationService(settings);
    for (const minGrams of [0, 10000, 30000]) {
      const res = await svc.classify({ minGrams, maxGrams: minGrams + 10000 });
      expect(res.orderType).toBe('BULK');
    }
  });

  it('still routes small orders to WEEKLY if an admin raises the limit later', async () => {
    const settings: any = { getBulkLimitKg: vi.fn(async () => 50) };
    const res = await new OrderClassificationService(settings).classify({ minGrams: 0, maxGrams: 10000 });
    expect(res.orderType).toBe('WEEKLY');
  });
});
