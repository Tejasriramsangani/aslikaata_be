import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DailyStatsService } from '../src/modules/analytics/daily-stats.service.js';
import { AnalyticsService } from '../src/modules/analytics/analytics.service.js';
import { AuditService } from '../src/modules/audit/audit.service.js';
import { DailyStatScope } from '../src/modules/analytics/schemas/daily-stat.schema.js';
import { SettlementType } from '../src/modules/settlements/schemas/settlement.schema.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';

describe('Phase 7: Analytics (dailystats), Admin Audits & Fraud Detection', () => {
  describe('7.1 DailyStatsService - Atomic Pre-Calculated Stats', () => {
    let mockStatModel: any;
    let dailyStatsService: DailyStatsService;

    beforeEach(() => {
      mockStatModel = {
        updateOne: vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
      };
      dailyStatsService = new DailyStatsService(mockStatModel);
    });

    it('Task 7.1.2: should update OVERALL, EMPLOYEE, PINCODE, CATEGORY, and PRODUCT scopes upon pickup completion', async () => {
      const mockPickup: any = {
        pickupCode: 'AK-10001',
        status: PickupStatus.COMPLETED,
        timestamps: {
          startedAt: new Date(Date.now() - 3600 * 1000), // 1 hour duration
          completedAt: new Date(),
        },
        totals: {
          grossWeightGrams: 20000,
          wastageGrams: 2000,
          netWeightGrams: 18000,
          totalAmount: 180000, // 1800.00 INR in paise
        },
        assignment: {
          employeeProfileId: 'emp-profile-10',
          employeeCode: 'EMP-101',
        },
        addressSnapshot: {
          pincode: '400001',
        },
        estimatedWeightSnapshot: {
          minGrams: 15000,
          maxGrams: 25000,
        },
        items: [
          {
            categoryId: 'cat-metal',
            productId: 'prod-copper',
            productName: 'Copper Scrap',
            grossWeightGrams: 20000,
            wastageGrams: 2000,
            netWeightGrams: 18000,
            amount: 180000,
          },
        ],
      };

      const mockSettlement: any = {
        type: SettlementType.UPI,
        amount: 180000,
      };

      await dailyStatsService.recordPickupCompletion(mockPickup, mockSettlement);

      // Verify overall scope update
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.OVERALL }),
        expect.objectContaining({
          $inc: expect.objectContaining({
            pickupsCompleted: 1,
            grossWeightGrams: 20000,
            wastageGrams: 2000,
            netWeightGrams: 18000,
            totalAmount: 180000,
            upiAmount: 180000,
            cashAmount: 0,
            donationAmount: 0,
          }),
        }),
        expect.anything(),
      );

      // Verify employee scope update
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.EMPLOYEE, refId: 'emp-profile-10' }),
        expect.anything(),
        expect.anything(),
      );

      // Verify pincode scope update
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.PINCODE, refKey: '400001' }),
        expect.anything(),
        expect.anything(),
      );

      // Verify category scope update
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.CATEGORY, refId: 'cat-metal' }),
        expect.anything(),
        expect.anything(),
      );

      // Verify product scope update
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.PRODUCT, refId: 'prod-copper' }),
        expect.anything(),
        expect.anything(),
      );
    });

    it('Task 7.1.2: should increment cancelled and failed counters', async () => {
      await dailyStatsService.recordPickupCancellation();
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.OVERALL }),
        { $inc: { pickupsCancelled: 1 } },
        expect.anything(),
      );

      await dailyStatsService.recordPickupFailure();
      expect(mockStatModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ scope: DailyStatScope.OVERALL }),
        { $inc: { pickupsFailed: 1 } },
        expect.anything(),
      );
    });
  });

  describe('7.2 AnalyticsService & Fraud Detection', () => {
    let mockStatModel: any;
    let mockPickupModel: any;
    let mockEmployeeProfileModel: any;
    let analyticsService: AnalyticsService;

    beforeEach(() => {
      mockStatModel = {
        findOne: vi.fn(),
        find: vi.fn(),
        aggregate: vi.fn(),
      };
      mockPickupModel = {
        find: vi.fn(),
      };
      mockEmployeeProfileModel = {
        findById: vi.fn(),
      };
      analyticsService = new AnalyticsService(
        mockStatModel,
        mockPickupModel,
        mockEmployeeProfileModel,
      );
    });

    it('Task 7.1.3: should calculate today metrics including live status and weight', async () => {
      mockPickupModel.find.mockResolvedValue([
        {
          status: PickupStatus.REQUESTED,
          totals: null,
        },
        {
          status: PickupStatus.ASSIGNED,
          assignment: { employeeProfileId: 'emp-1' },
          totals: null,
        },
        {
          status: PickupStatus.COMPLETED,
          totals: {
            grossWeightGrams: 10000,
            wastageGrams: 1000,
            netWeightGrams: 9000,
            totalAmount: 90000,
          },
        },
      ]);

      mockStatModel.findOne.mockResolvedValue({
        totalAmount: 90000,
        cashAmount: 90000,
        upiAmount: 0,
        donationAmount: 0,
      });

      const todayMetrics = await analyticsService.getTodayMetrics();

      expect(todayMetrics.unassignedRequests).toBe(1);
      expect(todayMetrics.activeEmployeesCount).toBe(1);
      expect(todayMetrics.weightCollected.grossWeightGrams).toBe(10000);
      expect(todayMetrics.weightCollected.netWeightGrams).toBe(9000);
      expect(todayMetrics.weightCollected.wastagePercentage).toBe(10);
      expect(todayMetrics.financials.cashAmount).toBe(90000);
    });

    it('Task 7.1.3: should detect employee fraud signal when wastage exceeds threshold', async () => {
      mockStatModel.aggregate.mockResolvedValue([
        {
          _id: 'emp-bad',
          employeeCode: 'EMP-99',
          pickupsCompleted: 5,
          pickupsFailed: 0,
          grossWeightGrams: 100000,
          wastageGrams: 30000, // 30% wastage! Exceeds 15% threshold
          netWeightGrams: 70000,
          totalAmount: 700000,
          durationSecondsTotal: 3000,
        },
        {
          _id: 'emp-good',
          employeeCode: 'EMP-12',
          pickupsCompleted: 10,
          pickupsFailed: 0,
          grossWeightGrams: 200000,
          wastageGrams: 10000, // 5% wastage - clean
          netWeightGrams: 190000,
          totalAmount: 1900000,
          durationSecondsTotal: 6000,
        },
      ]);

      mockEmployeeProfileModel.findById.mockImplementation((id: string) => {
        if (id === 'emp-bad') return Promise.resolve({ fullName: 'Shady Operator' });
        return Promise.resolve({ fullName: 'Honest Worker' });
      });

      const results = await analyticsService.getEmployeeAnalytics(undefined, undefined, 15);

      const flagged = results.find((r) => r.employeeProfileId === 'emp-bad');
      expect(flagged?.wastagePercentage).toBe(30);
      expect(flagged?.fraudSignal).toBe(true);
      expect(flagged?.fraudWarning).toContain('High wastage rate detected');

      const honest = results.find((r) => r.employeeProfileId === 'emp-good');
      expect(honest?.wastagePercentage).toBe(5);
      expect(honest?.fraudSignal).toBe(false);
      expect(honest?.fraudWarning).toBeNull();
    });

    it('Task 7.1.3: should rank pincodes by collected scrap volume', async () => {
      mockStatModel.aggregate.mockResolvedValue([
        {
          _id: '400001',
          pickupsCompleted: 15,
          grossWeightGrams: 300000,
          wastageGrams: 30000,
          netWeightGrams: 270000,
          totalAmount: 2700000,
        },
      ]);

      const pincodes = await analyticsService.getPincodeAnalytics();
      expect(pincodes.length).toBe(1);
      expect(pincodes[0].pincode).toBe('400001');
      expect(pincodes[0].netWeightGrams).toBe(270000);
    });
  });

  describe('7.3 AuditService - Admin Audit Trail', () => {
    let mockAuditModel: any;
    let auditService: AuditService;

    beforeEach(() => {
      mockAuditModel = {
        create: vi.fn(),
        countDocuments: vi.fn(),
        find: vi.fn(),
      };
      auditService = new AuditService(mockAuditModel);
    });

    it('Task 7.2.1: should append audit log with actor and resource metadata', async () => {
      mockAuditModel.create.mockResolvedValue({
        actorId: 'admin-1',
        action: 'VIEW_KYC_DOCUMENTS',
        resource: 'employeeprofiles',
      });

      const log = await auditService.recordLog({
        actorId: 'admin-1',
        actorRole: 'ADMIN',
        action: 'VIEW_KYC_DOCUMENTS',
        resource: 'employeeprofiles',
        resourceId: 'prof-99',
        ipAddress: '192.168.1.5',
      });

      expect(log.action).toBe('VIEW_KYC_DOCUMENTS');
      expect(mockAuditModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'admin-1',
          action: 'VIEW_KYC_DOCUMENTS',
          resource: 'employeeprofiles',
          resourceId: 'prof-99',
          ipAddress: '192.168.1.5',
        }),
      );
    });

    it('Task 7.2.1: should query audit logs with pagination and filters', async () => {
      mockAuditModel.countDocuments.mockResolvedValue(25);
      const mockQuery = {
        sort: vi.fn().mockReturnThis(),
        skip: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([
          { _id: 'log-1', action: 'UPDATE_RATE', resource: 'scraprates' },
        ]),
      };
      mockAuditModel.find.mockReturnValue(mockQuery);

      const result = await auditService.queryLogs({
        action: 'UPDATE_RATE',
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(25);
      expect(result.totalPages).toBe(3);
      expect(result.logs.length).toBe(1);
    });
  });
});
