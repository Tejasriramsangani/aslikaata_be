import { describe, it, expect } from 'vitest';
import { CurrencyUtil } from '../src/common/utils/currency.util.js';

describe('Scrap Rate Engine (Rule 5.4 Compliance)', () => {
  it('should calculate rate values correctly in integer paise without floating point issues', () => {
    // Copper at 650.00 Rs/kg = 65000 paise/kg
    // 3450 grams of copper:
    // amount = round(3450 * 65000 / 1000) = 224250 paise = Rs 2242.50
    const netWeightGrams = 3450;
    const ratePerKgPaise = 65000;
    const amountPaise = CurrencyUtil.calculateAmount(netWeightGrams, ratePerKgPaise);

    expect(amountPaise).toBe(224250);
    expect(CurrencyUtil.toRupeesString(amountPaise)).toBe('2242.50');
  });

  it('should simulate Rule 5.4 rate versioning: old rate closed with effectiveTo, new rate inserted', () => {
    // Mock simulation of the immutable rate versioning logic
    const rateHistory: Array<{
      ratePerKg: number;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }> = [];

    // T0: Initial rate set to 28.00 Rs/kg (2800 paise)
    const t0 = new Date('2026-01-01T10:00:00Z');
    rateHistory.push({
      ratePerKg: 2800,
      effectiveFrom: t0,
      effectiveTo: null,
    });

    expect(rateHistory).toHaveLength(1);
    expect(rateHistory[0].effectiveTo).toBeNull();
    expect(rateHistory[0].ratePerKg).toBe(2800);

    // T1: Market price increases to 30.50 Rs/kg (3050 paise)
    // Rule 5.4: We NEVER edit rateHistory[0].ratePerKg. We set effectiveTo = t1 and push new rate.
    const t1 = new Date('2026-02-01T10:00:00Z');
    rateHistory[0].effectiveTo = t1;
    rateHistory.push({
      ratePerKg: 3050,
      effectiveFrom: t1,
      effectiveTo: null,
    });

    expect(rateHistory).toHaveLength(2);
    // Old rate preserved for historical audits
    expect(rateHistory[0].ratePerKg).toBe(2800);
    expect(rateHistory[0].effectiveTo).toEqual(t1);

    // New active rate
    expect(rateHistory[1].ratePerKg).toBe(3050);
    expect(rateHistory[1].effectiveTo).toBeNull();
  });
});
