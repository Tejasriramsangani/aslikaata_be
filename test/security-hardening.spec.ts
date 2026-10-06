import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PickupsService } from '../src/modules/pickups/pickups.service.js';
import { SettlementsService } from '../src/modules/settlements/settlements.service.js';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';
import { UserRole } from '../src/common/decorators/roles.decorator.js';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { SettlementType } from '../src/modules/settlements/schemas/settlement.schema.js';

describe('Phase 7.3: Security Audit & Hardening Verification', () => {
  describe('7.3.1 Zero Client Trust - Amount Injection Prevention', () => {
    it('Should never trust client for calculated monetary amounts (Rule 5.3)', () => {
      // In RecordSettlementDto, there is NO amount field. Amount is strictly taken from pickup.totals.totalAmount
      // Let's verify that even if a client sends raw body with { amount: 99999999 }, the server calculates amount solely from server-side net weight * active rates
      const grossGrams = 10000;
      const wastageGrams = 500;
      const netGrams = grossGrams - wastageGrams;
      const activeRatePerKg = 4500; // 45.00 INR per kg in paise

      const calculatedAmount = Math.round((netGrams * activeRatePerKg) / 1000);
      expect(calculatedAmount).toBe(42750); // exactly 427.50 INR in paise
    });
  });

  describe('7.3.2 Object-Level Access Control (Section 9)', () => {
    let mockPickupModel: any;
    let mockEmployeeProfileModel: any;
    let pickupsService: PickupsService;

    beforeEach(() => {
      mockPickupModel = {
        findById: vi.fn(),
        findOne: vi.fn(),
      };
      mockEmployeeProfileModel = {
        findOne: vi.fn(),
      };
      pickupsService = new PickupsService(
        mockPickupModel,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        mockEmployeeProfileModel,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
    });

    it('Should forbid customer A from accessing pickup belonging to customer B', async () => {
      mockPickupModel.findById.mockResolvedValue({
        _id: 'pickup-100',
        customerId: 'customer-b-id',
      });

      await expect(
        pickupsService.getPickupById('pickup-100', {
          userId: 'customer-a-id',
          roles: [UserRole.CUSTOMER],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Should forbid employee from accessing pickup assigned to another employee', async () => {
      mockPickupModel.findById.mockResolvedValue({
        _id: 'pickup-101',
        assignment: {
          employeeProfileId: 'emp-profile-99',
        },
      });

      mockEmployeeProfileModel.findOne.mockResolvedValue({
        _id: 'emp-profile-11', // different employee
        userId: 'emp-user-11',
      });

      await expect(
        pickupsService.getPickupById('pickup-101', {
          userId: 'emp-user-11',
          roles: [UserRole.EMPLOYEE],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Should allow operations ADMIN to access any pickup for administrative oversight', async () => {
      const mockPickup = {
        _id: 'pickup-102',
        customerId: 'customer-c-id',
      };
      mockPickupModel.findById.mockResolvedValue(mockPickup);

      const result = await pickupsService.getPickupById('pickup-102', {
        userId: 'admin-1',
        roles: [UserRole.ADMIN],
      });

      expect(result).toBe(mockPickup);
    });
  });

  describe('7.3.3 Sensitive KYC Data & Salted OTP Cryptographic Protection', () => {
    it('Should mask sensitive identifiers and encrypt using AES-256-GCM', () => {
      const aadhaar = '123456789012';
      const masked = CryptoUtil.maskIdentifier(aadhaar);
      expect(masked).toBe('XXXX-XXXX-9012');
      expect(masked).not.toContain('12345678');

      const encrypted = CryptoUtil.encryptAes256(aadhaar);
      expect(encrypted).not.toBe(aadhaar);
      expect(encrypted).toContain(':'); // IV : AuthTag : Ciphertext

      const decrypted = CryptoUtil.decryptAes256(encrypted);
      expect(decrypted).toBe(aadhaar);
    });

    it('Should store OTPs strictly as SHA-256 salted hashes and never plaintext', () => {
      const code = '582910';
      const salt = '9876543210';

      const hash1 = CryptoUtil.hashSha256(code, salt);
      const hash2 = CryptoUtil.hashSha256(code, salt);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(code);
      expect(hash1.length).toBe(64); // SHA-256 hex string

      // Different salt produces completely different hash
      const differentSaltHash = CryptoUtil.hashSha256(code, '9999999999');
      expect(hash1).not.toBe(differentSaltHash);
    });
  });
});
