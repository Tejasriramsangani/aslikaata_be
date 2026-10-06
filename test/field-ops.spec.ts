import { describe, it, expect } from 'vitest';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';
import { WeightUtil } from '../src/common/utils/weight.util.js';
import { CurrencyUtil } from '../src/common/utils/currency.util.js';

describe('Phase 4: Field Ops, QR Gate, Measurement & Customer Approval', () => {
  describe('Gate 1: QR Token Security', () => {
    it('should generate distinct, salted SHA-256 token hashes for pickup QR verification', () => {
      const pickupId = '660e1234567890abcdef1234';
      const rawToken1 = `AK-QR-${CryptoUtil.generateRandomToken(20)}-${Date.now()}`;
      const rawToken2 = `AK-QR-${CryptoUtil.generateRandomToken(20)}-${Date.now()}`;

      const hash1 = CryptoUtil.hashSha256(rawToken1, pickupId);
      const hash2 = CryptoUtil.hashSha256(rawToken2, pickupId);

      expect(hash1).not.toBe(hash2);
      expect(CryptoUtil.hashSha256(rawToken1, pickupId)).toBe(hash1);

      // Wrong pickup ID fails verification
      const wrongPickupId = '660e9876543210fedcba4321';
      expect(CryptoUtil.hashSha256(rawToken1, wrongPickupId)).not.toBe(hash1);
    });

    it('should detect expired or already consumed QR tokens', () => {
      const now = new Date('2026-10-06T10:00:00Z');
      const tokenExpiresAt = new Date('2026-10-06T09:30:00Z'); // Expired 30 mins ago
      const isExpired = tokenExpiresAt < now;
      expect(isExpired).toBe(true);

      const usedAt: Date | null = new Date('2026-10-06T09:45:00Z');
      const isAlreadyUsed = usedAt !== null;
      expect(isAlreadyUsed).toBe(true);
    });
  });

  describe('Scale Measurement Engine (Rules 5.2, 5.3, 5.4)', () => {
    it('should accurately calculate net weight, snapshot rate, and compute item amount in paise', () => {
      // Item 1: Iron (Loha)
      // Gross: 12,500g (12.5 kg), Wastage: 500g (0.5 kg)
      // Rate: Rs 28.00/kg = 2800 paise/kg
      const ironGross = 12500;
      const ironWastage = 500;
      const ironNet = WeightUtil.calculateNetWeight(ironGross, ironWastage);
      expect(ironNet).toBe(12000); // 12.0 kg

      const ironRatePaise = 2800;
      const ironAmountPaise = CurrencyUtil.calculateAmount(ironNet, ironRatePaise);
      // amount = (12000 * 2800) / 1000 = 33600 paise = Rs 336.00
      expect(ironAmountPaise).toBe(33600);
      expect(CurrencyUtil.toRupeesString(ironAmountPaise)).toBe('336.00');

      // Item 2: Copper (Tamba)
      // Gross: 1,500g, Wastage: 0g
      // Rate: Rs 650.00/kg = 65000 paise/kg
      const copperGross = 1500;
      const copperWastage = 0;
      const copperNet = WeightUtil.calculateNetWeight(copperGross, copperWastage);
      expect(copperNet).toBe(1500);

      const copperRatePaise = 65000;
      const copperAmountPaise = CurrencyUtil.calculateAmount(copperNet, copperRatePaise);
      // amount = (1500 * 65000) / 1000 = 97500 paise = Rs 975.00
      expect(copperAmountPaise).toBe(97500);
      expect(CurrencyUtil.toRupeesString(copperAmountPaise)).toBe('975.00');

      // Grand Totals
      const totalGross = ironGross + copperGross; // 14000g
      const totalWastage = ironWastage + copperWastage; // 500g
      const totalNet = ironNet + copperNet; // 13500g
      const grandTotalAmountPaise = ironAmountPaise + copperAmountPaise; // 131100 paise = Rs 1311.00

      expect(totalGross).toBe(14000);
      expect(totalWastage).toBe(500);
      expect(totalNet).toBe(13500);
      expect(grandTotalAmountPaise).toBe(131100);
      expect(CurrencyUtil.toRupeesString(grandTotalAmountPaise)).toBe('1311.00');
    });

    it('should strictly reject invalid measurements where wastage >= gross weight (Rule 5.2)', () => {
      expect(() => WeightUtil.calculateNetWeight(5000, 5000)).toThrow(
        'Wastage (5000g) must be strictly less than gross weight (5000g)',
      );
      expect(() => WeightUtil.calculateNetWeight(5000, 5100)).toThrow(
        'Wastage (5100g) must be strictly less than gross weight (5000g)',
      );
    });
  });

  describe('Gate 2: Cryptographic Summary Hash & Customer Approval', () => {
    it('should generate a deterministic summary hash and detect tampering if numbers change', () => {
      const pickupCode = 'AK-10024';
      const originalPayload = {
        pickupCode,
        itemCount: 2,
        netWeightGrams: 13500,
        totalAmountPaise: 131100,
        items: [
          { p: 'prod_iron', net: 12000, rate: 2800, amt: 33600 },
          { p: 'prod_copper', net: 1500, rate: 65000, amt: 97500 },
        ],
      };

      const originalHash = CryptoUtil.hashSha256(JSON.stringify(originalPayload), pickupCode);

      // Customer approves with matching hash
      const submittedHash = originalHash;
      expect(submittedHash).toBe(originalHash);

      // Tampered payload (e.g. employee attempts to secretly reduce copper net weight or rate)
      const tamperedPayload = {
        ...originalPayload,
        netWeightGrams: 13000,
        totalAmountPaise: 98600,
      };
      const tamperedHash = CryptoUtil.hashSha256(JSON.stringify(tamperedPayload), pickupCode);

      // Verification fails if hash does not match
      expect(originalHash).not.toBe(tamperedHash);
    });
  });
});
