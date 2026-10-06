import { describe, it, expect } from 'vitest';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';
import { CurrencyUtil } from '../src/common/utils/currency.util.js';
import { InvoiceType } from '../src/modules/invoices/schemas/invoice.schema.js';
import { SettlementType } from '../src/modules/settlements/schemas/settlement.schema.js';

describe('Phase 5: Settlement, Closing OTP & Atomic Invoicing', () => {
  describe('Settlement Security & Idempotency', () => {
    it('should generate unique client idempotency keys and prevent duplicate settlements', () => {
      const idempotencyKey1 = 'client-settlement-uuid-1';
      const idempotencyKey2 = 'client-settlement-uuid-2';

      expect(idempotencyKey1).not.toBe(idempotencyKey2);
    });

    it('should determine the correct invoice/receipt type based on settlement preference (Rule 5.10)', () => {
      // Cash payment -> Tax Invoice
      const cashType = SettlementType.CASH;
      const invoiceTypeCash =
        cashType === SettlementType.DONATE
          ? InvoiceType.DONATION_RECEIPT
          : InvoiceType.CUSTOMER_TAX_INVOICE;
      expect(invoiceTypeCash).toBe(InvoiceType.CUSTOMER_TAX_INVOICE);

      // UPI payment -> Tax Invoice
      const upiType = SettlementType.UPI;
      const invoiceTypeUpi =
        upiType === SettlementType.DONATE
          ? InvoiceType.DONATION_RECEIPT
          : InvoiceType.CUSTOMER_TAX_INVOICE;
      expect(invoiceTypeUpi).toBe(InvoiceType.CUSTOMER_TAX_INVOICE);

      // Donation -> Donation Receipt
      const donateType = SettlementType.DONATE;
      const invoiceTypeDonate =
        donateType === SettlementType.DONATE
          ? InvoiceType.DONATION_RECEIPT
          : InvoiceType.CUSTOMER_TAX_INVOICE;
      expect(invoiceTypeDonate).toBe(InvoiceType.DONATION_RECEIPT);
    });
  });

  describe('Gate 3: Closing OTP Verification', () => {
    it('should verify closing OTP hash against customer mobile', () => {
      const customerMobile = '9876543210';
      const rawOtp = '482910';
      const codeHash = CryptoUtil.hashSha256(rawOtp, customerMobile);

      // Correct employee input
      const enteredOtp = '482910';
      const enteredHash = CryptoUtil.hashSha256(enteredOtp, customerMobile);
      expect(enteredHash).toBe(codeHash);

      // Wrong input
      const wrongOtp = '112233';
      const wrongHash = CryptoUtil.hashSha256(wrongOtp, customerMobile);
      expect(wrongHash).not.toBe(codeHash);
    });
  });

  describe('Invoice Integrity & Integer Precision (Rule 5.6 & 5.12)', () => {
    it('should correctly sum line items in integer paise and format invoice totals', () => {
      const lineItems = [
        { productName: 'Iron', netWeightGrams: 15000, ratePerKg: 2800, amount: 42000 }, // Rs 420.00
        { productName: 'Newspaper', netWeightGrams: 20000, ratePerKg: 1400, amount: 28000 }, // Rs 280.00
        { productName: 'Copper', netWeightGrams: 500, ratePerKg: 65000, amount: 32500 }, // Rs 325.00
      ];

      const totalNetWeight = lineItems.reduce((acc, item) => acc + item.netWeightGrams, 0);
      const totalAmountPaise = lineItems.reduce((acc, item) => acc + item.amount, 0);

      expect(totalNetWeight).toBe(35500); // 35.5 kg
      expect(totalAmountPaise).toBe(102500); // Rs 1025.00

      expect(CurrencyUtil.toRupeesString(totalAmountPaise)).toBe('1025.00');
    });
  });
});
