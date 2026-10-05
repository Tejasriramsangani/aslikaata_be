/**
 * Currency Utility for ASLI KAATA
 * Strictly handles all money values in integer paise to eliminate floating point rounding errors.
 * 1 Rupee = 100 Paise.
 */
export class CurrencyUtil {
  /**
   * Converts rupees (e.g. 45.50) to integer paise (4550).
   */
  static toPaise(rupees: number): number {
    return Math.round(rupees * 100);
  }

  /**
   * Converts integer paise to rupee string with 2 decimal places (e.g. 4550 -> "45.50").
   */
  static toRupeesString(paise: number): string {
    return (paise / 100).toFixed(2);
  }

  /**
   * Calculates item amount in integer paise from net weight in grams and rate per kg in paise:
   * amount (paise) = round((netWeightGrams * ratePerKgPaise) / 1000)
   */
  static calculateAmount(netWeightGrams: number, ratePerKgPaise: number): number {
    if (netWeightGrams < 0 || ratePerKgPaise < 0) {
      throw new Error('Weight and rate must be non-negative');
    }
    return Math.round((netWeightGrams * ratePerKgPaise) / 1000);
  }
}
