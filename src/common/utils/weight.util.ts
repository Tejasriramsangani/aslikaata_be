/**
 * Weight Utility for ASLI KAATA
 * Strictly handles all weight values in integer grams.
 * Enforces Rule 5.2: wastage must be >= 0 and strictly < gross weight.
 */
export class WeightUtil {
  /**
   * Validates and calculates net weight in grams.
   */
  static calculateNetWeight(grossWeightGrams: number, wastageGrams: number = 0): number {
    if (!Number.isInteger(grossWeightGrams) || grossWeightGrams <= 0) {
      throw new Error(`Gross weight must be a positive integer, got ${grossWeightGrams}`);
    }
    if (!Number.isInteger(wastageGrams) || wastageGrams < 0) {
      throw new Error(`Wastage weight must be a non-negative integer, got ${wastageGrams}`);
    }
    if (wastageGrams >= grossWeightGrams) {
      throw new Error(
        `Wastage (${wastageGrams}g) must be strictly less than gross weight (${grossWeightGrams}g)`
      );
    }
    return grossWeightGrams - wastageGrams;
  }

  /**
   * Converts grams to a human-readable kilograms string (e.g. 1250g -> "1.25 kg").
   */
  static toKgString(grams: number): string {
    return `${(grams / 1000).toFixed(2)} kg`;
  }
}
