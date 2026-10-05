import { describe, it, expect } from 'vitest';
import { CurrencyUtil } from '../src/common/utils/currency.util.js';

describe('CurrencyUtil', () => {
  it('should convert rupees to paise correctly', () => {
    expect(CurrencyUtil.toPaise(10)).toBe(1000);
    expect(CurrencyUtil.toPaise(45.50)).toBe(4550);
    expect(CurrencyUtil.toPaise(0.25)).toBe(25);
  });

  it('should format paise into rupee string with 2 decimal places', () => {
    expect(CurrencyUtil.toRupeesString(1000)).toBe('10.00');
    expect(CurrencyUtil.toRupeesString(4550)).toBe('45.50');
    expect(CurrencyUtil.toRupeesString(25)).toBe('0.25');
  });

  it('should calculate item amount accurately using integer paise formula', () => {
    // 2500g of scrap at 20.00 Rs/kg (2000 paise/kg)
    // amount = (2500 * 2000) / 1000 = 5000 paise = 50.00 Rs
    const amount = CurrencyUtil.calculateAmount(2500, 2000);
    expect(amount).toBe(5000);
  });

  it('should throw an error if weight or rate is negative', () => {
    expect(() => CurrencyUtil.calculateAmount(-100, 2000)).toThrow();
    expect(() => CurrencyUtil.calculateAmount(100, -2000)).toThrow();
  });
});
