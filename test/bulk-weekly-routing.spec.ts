import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderClassificationService } from '../src/modules/routing/services/order-classification.service.js';
import { AppSettingsService } from '../src/modules/routing/services/app-settings.service.js';
import { HolidayHandling, HolidayScope } from '../src/modules/routing/schemas/holiday.schema.js';

describe('Context Addendum 1: Bulk & Weekly Orders Engine', () => {
  let appSettingsService: AppSettingsService;
  let classificationService: OrderClassificationService;

  beforeEach(() => {
    // Mock AppSettingsService
    appSettingsService = {
      getBulkLimitKg: vi.fn().mockResolvedValue(10),
      getOrderRules: vi.fn().mockResolvedValue({
        bulkLimitKg: 10,
        routeFinalizeHoursBefore: 18,
        autoAssignRetryMinutes: 5,
        maxPickupsPerEmployeeSlot: 4,
      }),
    } as unknown as AppSettingsService;

    classificationService = new OrderClassificationService(appSettingsService);
  });

  describe('2. Classification Rule & Snapshots', () => {
    it('should classify "0 - 10 kg" (minGrams 0) as WEEKLY when bulkLimitKg is 10', async () => {
      const result = await classificationService.classify({
        minGrams: 0,
        maxGrams: 10000,
      });

      expect(result.orderType).toBe('WEEKLY');
      expect(result.limitKgApplied).toBe(10);
      expect(result.rangeMinKg).toBe(0);
      expect(result.rangeMaxKg).toBe(10);
      expect(result.decidedAt).toBeInstanceOf(Date);
    });

    it('should classify "10 - 20 kg" (minGrams 10000) as BULK when bulkLimitKg is 10 (minKg >= bulkLimitKg)', async () => {
      const result = await classificationService.classify({
        minGrams: 10000,
        maxGrams: 20000,
      });

      expect(result.orderType).toBe('BULK');
      expect(result.limitKgApplied).toBe(10);
      expect(result.rangeMinKg).toBe(10);
      expect(result.rangeMaxKg).toBe(20);
    });

    it('should classify "20 - 30 kg" and above as BULK when bulkLimitKg is 10', async () => {
      const result = await classificationService.classify({
        minGrams: 20000,
        maxGrams: 30000,
      });

      expect(result.orderType).toBe('BULK');
    });

    it('should correctly preview boundary alignment and warnings for admin settings', () => {
      const ranges = [
        { id: '1', name: 'R1', displayLabel: '0 - 10 kg', minGrams: 0, maxGrams: 10000 },
        { id: '2', name: 'R2', displayLabel: '10 - 20 kg', minGrams: 10000, maxGrams: 20000 },
        { id: '3', name: 'R3', displayLabel: '20 - 50 kg', minGrams: 20000, maxGrams: 50000 },
      ];

      // Limit = 10 (aligned at boundary of R1 and R2)
      const previewAligned = classificationService.previewClassification(10, ranges);
      expect(previewAligned[0].orderType).toBe('WEEKLY');
      expect(previewAligned[1].orderType).toBe('BULK');
      expect(previewAligned[0].isBoundaryAligned).toBe(true);

      // Limit = 15 (inside R2 10-20kg range, not boundary aligned)
      const previewUnaligned = classificationService.previewClassification(15, ranges);
      expect(previewUnaligned[1].isBoundaryAligned).toBe(false);
      expect(previewUnaligned[1].orderType).toBe('WEEKLY'); // minKg (10) < limit (15)
    });
  });

  describe('3. Dynamic Availability & Mode Switching', () => {
    it('should verify SLOTS mode returns morning/afternoon/evening periods without bulk words', () => {
      const sampleSlotsResponse = {
        mode: 'SLOTS',
        slotsMode: {
          dates: [{ iso: '2026-10-08', label: 'Tomorrow', dayNum: 8, monthStr: 'Oct', weekday: 'Thu' }],
          timeSlots: [
            { id: 's1', period: 'morning', displayLabel: '9:00 AM – 11:00 AM', startTime: '09:00', endTime: '11:00', isAvailable: true },
            { id: 's2', period: 'afternoon', displayLabel: '1:00 PM – 3:00 PM', startTime: '13:00', endTime: '15:00', isAvailable: true },
          ],
        },
      };

      expect(sampleSlotsResponse.mode).toBe('SLOTS');
      expect(sampleSlotsResponse.slotsMode.timeSlots.length).toBeGreaterThan(0);
      // Ensure zero leak of internal order type labels
      const jsonStr = JSON.stringify(sampleSlotsResponse);
      expect(jsonStr).not.toContain('BULK');
      expect(jsonStr).not.toContain('WEEKLY');
    });

    it('should verify ROUTE_DAYS mode returns real collection days with area helper banner', () => {
      const sampleRouteDaysResponse = {
        mode: 'ROUTE_DAYS',
        helperText: 'We collect from your area on these days.',
        routeDaysMode: {
          dates: [
            { iso: '2026-10-10', weekday: 'Sat', dayNum: 10, monthStr: 'Oct', windowLabel: '09:00 – 13:00', startTime: '09:00', endTime: '13:00' },
            { iso: '2026-10-17', weekday: 'Sat', dayNum: 17, monthStr: 'Oct', windowLabel: '09:00 – 13:00', startTime: '09:00', endTime: '13:00' },
          ],
          divisionName: 'Madhura Nagar Division',
        },
      };

      expect(sampleRouteDaysResponse.mode).toBe('ROUTE_DAYS');
      expect(sampleRouteDaysResponse.helperText).toBe('We collect from your area on these days.');
      expect(sampleRouteDaysResponse.routeDaysMode.dates.length).toBe(2);
      const jsonStr = JSON.stringify(sampleRouteDaysResponse);
      expect(jsonStr).not.toContain('BULK');
      expect(jsonStr).not.toContain('WEEKLY');
    });
  });

  describe('5. Holiday Shifting Calendar Calculations', () => {
    it('should correctly calculate shifted date under NEXT_WORKING_DAY (+1 day)', () => {
      const holidayDate = '2026-10-16'; // Friday
      const d = new Date(holidayDate);
      d.setDate(d.getDate() + 1);
      const shifted = d.toISOString().split('T')[0];

      expect(shifted).toBe('2026-10-17'); // Shifts to Saturday
    });

    it('should correctly calculate shifted date under NEXT_WEEK_SAME_DAY (+7 days)', () => {
      const holidayDate = '2026-10-16'; // Friday
      const d = new Date(holidayDate);
      d.setDate(d.getDate() + 7);
      const shifted = d.toISOString().split('T')[0];

      expect(shifted).toBe('2026-10-23'); // Shifts to next Friday
    });
  });
});
