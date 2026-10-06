import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DailyStat, DailyStatDocument, DailyStatScope } from './schemas/daily-stat.schema.js';
import { Pickup, PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../pickups/schemas/pickup-status.enum.js';
import { EmployeeProfile, EmployeeProfileDocument } from '../employees/schemas/employee-profile.schema.js';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(DailyStat.name)
    private readonly statModel: Model<DailyStatDocument>,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
  ) {}

  /**
   * Task 7.1.3: GET /api/v1/admin/analytics/today
   * Real-time aggregation of today's pickups, weight collected, money paid, and active ops.
   */
  async getTodayMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Pickups scheduled or created today
    const pickupsToday = await this.pickupModel.find({
      createdAt: { $gte: today, $lt: tomorrow },
    });

    const statusCounts: Record<string, number> = {};
    for (const s of Object.values(PickupStatus)) {
      statusCounts[s] = 0;
    }

    let unassignedRequests = 0;
    const activeEmployeeIds = new Set<string>();

    let grossWeightGrams = 0;
    let wastageGrams = 0;
    let netWeightGrams = 0;
    let totalAmount = 0;

    for (const p of pickupsToday) {
      statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

      if (p.status === PickupStatus.REQUESTED || p.status === PickupStatus.SCHEDULED) {
        unassignedRequests++;
      }

      if (
        p.assignment?.employeeProfileId &&
        [PickupStatus.ASSIGNED, PickupStatus.ON_THE_WAY, PickupStatus.ARRIVED, PickupStatus.VERIFIED, PickupStatus.IN_PROGRESS].includes(p.status)
      ) {
        activeEmployeeIds.add(p.assignment.employeeProfileId.toString());
      }

      if (p.totals) {
        grossWeightGrams += p.totals.grossWeightGrams || 0;
        wastageGrams += p.totals.wastageGrams || 0;
        netWeightGrams += p.totals.netWeightGrams || 0;
        totalAmount += p.totals.totalAmount || 0;
      }
    }

    // Today's pre-aggregated payment breakdown from dailystats if completed
    const dateKey = today.toISOString().split('T')[0];
    const todayStat = await this.statModel.findOne({
      date: dateKey,
      scope: DailyStatScope.OVERALL,
    });

    return {
      date: dateKey,
      statusDistribution: statusCounts,
      unassignedRequests,
      activeEmployeesCount: activeEmployeeIds.size,
      weightCollected: {
        grossWeightGrams,
        wastageGrams,
        netWeightGrams,
        wastagePercentage: grossWeightGrams > 0 ? Number(((wastageGrams / grossWeightGrams) * 100).toFixed(2)) : 0,
      },
      financials: {
        totalAmount: todayStat?.totalAmount || totalAmount,
        cashAmount: todayStat?.cashAmount || 0,
        upiAmount: todayStat?.upiAmount || 0,
        donationAmount: todayStat?.donationAmount || 0,
      },
    };
  }

  /**
   * Task 7.1.3: GET /api/v1/admin/analytics/trends
   * Aggregates historical metrics from pre-calculated dailystats.
   */
  async getTrends(startDate?: string, endDate?: string) {
    const filter: Record<string, any> = { scope: DailyStatScope.OVERALL };
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }

    const stats = await this.statModel.find(filter).sort({ date: 1 });

    return stats.map((s) => ({
      date: s.date,
      pickupsCompleted: s.pickupsCompleted,
      pickupsCancelled: s.pickupsCancelled,
      pickupsFailed: s.pickupsFailed,
      grossWeightGrams: s.grossWeightGrams,
      wastageGrams: s.wastageGrams,
      netWeightGrams: s.netWeightGrams,
      wastagePercentage: s.grossWeightGrams > 0 ? Number(((s.wastageGrams / s.grossWeightGrams) * 100).toFixed(2)) : 0,
      totalAmount: s.totalAmount,
      cashAmount: s.cashAmount,
      upiAmount: s.upiAmount,
      donationAmount: s.donationAmount,
      avgDurationMinutes: s.pickupsCompleted > 0 ? Number((s.durationSecondsTotal / s.pickupsCompleted / 60).toFixed(1)) : 0,
    }));
  }

  /**
   * Task 7.1.3: GET /api/v1/admin/analytics/employees
   * Employee performance & fraud detection on unusually high wastage percentage.
   */
  async getEmployeeAnalytics(startDate?: string, endDate?: string, thresholdWastagePercent: number = 15) {
    const filter: Record<string, any> = { scope: DailyStatScope.EMPLOYEE };
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }

    const employeeStats = await this.statModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$refId',
          employeeCode: { $first: '$refKey' },
          pickupsCompleted: { $sum: '$pickupsCompleted' },
          pickupsFailed: { $sum: '$pickupsFailed' },
          grossWeightGrams: { $sum: '$grossWeightGrams' },
          wastageGrams: { $sum: '$wastageGrams' },
          netWeightGrams: { $sum: '$netWeightGrams' },
          totalAmount: { $sum: '$totalAmount' },
          durationSecondsTotal: { $sum: '$durationSecondsTotal' },
        },
      },
    ]);

    const result = [];
    for (const stat of employeeStats) {
      const employee = await this.employeeProfileModel.findById(stat._id);
      const wastagePercentage =
        stat.grossWeightGrams > 0
          ? Number(((stat.wastageGrams / stat.grossWeightGrams) * 100).toFixed(2))
          : 0;

      const avgDurationMinutes =
        stat.pickupsCompleted > 0
          ? Number((stat.durationSecondsTotal / stat.pickupsCompleted / 60).toFixed(1))
          : 0;

      // Section 10 Fraud Detection: Unusually high wastage % is flagged
      const fraudSignal = wastagePercentage >= thresholdWastagePercent;

      result.push({
        employeeProfileId: stat._id,
        employeeCode: stat.employeeCode || employee?.employeeCode,
        fullName: employee?.fullName || 'Unknown',
        pickupsCompleted: stat.pickupsCompleted,
        pickupsFailed: stat.pickupsFailed,
        grossWeightGrams: stat.grossWeightGrams,
        wastageGrams: stat.wastageGrams,
        netWeightGrams: stat.netWeightGrams,
        wastagePercentage,
        totalAmount: stat.totalAmount,
        avgDurationMinutes,
        fraudSignal,
        fraudWarning: fraudSignal
          ? `High wastage rate detected (${wastagePercentage}% >= threshold ${thresholdWastagePercent}%)`
          : null,
      });
    }

    return result;
  }

  /**
   * Task 7.1.3: GET /api/v1/admin/analytics/pincodes
   * Regional scrap volume and demand distribution.
   */
  async getPincodeAnalytics(startDate?: string, endDate?: string) {
    const filter: Record<string, any> = { scope: DailyStatScope.PINCODE };
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = startDate;
      if (endDate) filter.date.$lte = endDate;
    }

    const pincodeStats = await this.statModel.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$refKey',
          pickupsCompleted: { $sum: '$pickupsCompleted' },
          grossWeightGrams: { $sum: '$grossWeightGrams' },
          wastageGrams: { $sum: '$wastageGrams' },
          netWeightGrams: { $sum: '$netWeightGrams' },
          totalAmount: { $sum: '$totalAmount' },
        },
      },
      { $sort: { netWeightGrams: -1 } },
    ]);

    return pincodeStats.map((p) => ({
      pincode: p._id,
      pickupsCompleted: p.pickupsCompleted,
      grossWeightGrams: p.grossWeightGrams,
      wastageGrams: p.wastageGrams,
      netWeightGrams: p.netWeightGrams,
      totalAmount: p.totalAmount,
    }));
  }
}
