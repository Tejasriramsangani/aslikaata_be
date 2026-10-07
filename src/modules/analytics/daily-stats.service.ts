import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type ClientSession } from 'mongoose';
import { DailyStat, DailyStatDocument, DailyStatScope } from './schemas/daily-stat.schema.js';
import { PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { SettlementDocument, SettlementType } from '../settlements/schemas/settlement.schema.js';

@Injectable()
export class DailyStatsService {
  private readonly logger = new Logger(DailyStatsService.name);

  constructor(
    @InjectModel(DailyStat.name)
    private readonly statModel: Model<DailyStatDocument>,
  ) {}

  /**
   * Helper to format a Date into 'YYYY-MM-DD' ISO date string.
   */
  formatDateKey(date: Date = new Date()): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * Task 7.1.2: Updates pre-aggregated daily stats upon pickup completion.
   * Runs within the money transaction session (Section 9).
   */
  async recordPickupCompletion(
    pickup: PickupDocument,
    settlement: SettlementDocument,
    session?: ClientSession,
  ): Promise<void> {
    const completedDate = pickup.timestamps?.completedAt || new Date();
    const dateKey = this.formatDateKey(completedDate);

    const grossGrams = pickup.totals?.grossWeightGrams || 0;
    const wastageGrams = pickup.totals?.wastageGrams || 0;
    const netGrams = pickup.totals?.netWeightGrams || 0;
    const totalAmount = pickup.totals?.totalAmount || 0;

    let cashAmount = 0;
    let upiAmount = 0;
    let donationAmount = 0;

    if (settlement.type === SettlementType.CASH) {
      cashAmount = totalAmount;
    } else if (settlement.type === SettlementType.UPI) {
      upiAmount = totalAmount;
    } else if (settlement.type === SettlementType.DONATE) {
      donationAmount = totalAmount;
    }

    // Calculate duration in seconds (startedAt -> completedAt or arrivedAt -> completedAt)
    let durationSeconds = 0;
    if (pickup.timestamps?.startedAt && pickup.timestamps?.completedAt) {
      durationSeconds = Math.max(
        0,
        Math.floor((pickup.timestamps.completedAt.getTime() - pickup.timestamps.startedAt.getTime()) / 1000),
      );
    } else if (pickup.timestamps?.arrivedAt && pickup.timestamps?.completedAt) {
      durationSeconds = Math.max(
        0,
        Math.floor((pickup.timestamps.completedAt.getTime() - pickup.timestamps.arrivedAt.getTime()) / 1000),
      );
    }

    // Estimate variance (if estimated weight snapshot exists in integer grams)
    let estimateVarianceGrams = 0;
    if (pickup.estimatedWeightSnapshot?.minGrams) {
      const estimatedAvgGrams =
        (pickup.estimatedWeightSnapshot.minGrams +
          (pickup.estimatedWeightSnapshot.maxGrams || pickup.estimatedWeightSnapshot.minGrams)) /
        2;
      estimateVarianceGrams = Math.abs(netGrams - estimatedAvgGrams);
    }

    const incBase = {
      pickupsCompleted: 1,
      grossWeightGrams: grossGrams,
      wastageGrams,
      netWeightGrams: netGrams,
      totalAmount,
      cashAmount,
      upiAmount,
      donationAmount,
      durationSecondsTotal: durationSeconds,
      estimateVarianceGrams,
    };

    // 1. OVERALL Scope
    await this.statModel.updateOne(
      { date: dateKey, scope: DailyStatScope.OVERALL, refId: null, refKey: null },
      { $inc: incBase },
      { upsert: true, session },
    );

    // 2. EMPLOYEE Scope
    const employeeId = pickup.assignment?.employeeProfileId;
    if (employeeId) {
      await this.statModel.updateOne(
        { date: dateKey, scope: DailyStatScope.EMPLOYEE, refId: employeeId, refKey: pickup.assignment?.employeeCode || null },
        { $inc: incBase },
        { upsert: true, session },
      );
    }

    // 3. PINCODE Scope
    const pincode = pickup.addressSnapshot?.pincode;
    if (pincode) {
      await this.statModel.updateOne(
        { date: dateKey, scope: DailyStatScope.PINCODE, refId: null, refKey: pincode },
        { $inc: incBase },
        { upsert: true, session },
      );
    }

    // 4. CATEGORY and PRODUCT Scopes
    if (pickup.items && pickup.items.length > 0) {
      for (const item of pickup.items) {
        const itemInc = {
          grossWeightGrams: item.grossWeightGrams,
          wastageGrams: item.wastageGrams,
          netWeightGrams: item.netWeightGrams,
          totalAmount: item.amount,
        };

        if (item.categoryId) {
          await this.statModel.updateOne(
            { date: dateKey, scope: DailyStatScope.CATEGORY, refId: item.categoryId, refKey: null },
            { $inc: itemInc },
            { upsert: true, session },
          );
        }

        if (item.productId) {
          await this.statModel.updateOne(
            { date: dateKey, scope: DailyStatScope.PRODUCT, refId: item.productId, refKey: item.productName || null },
            { $inc: itemInc },
            { upsert: true, session },
          );
        }
      }
    }

    this.logger.log(`Updated dailystats for completed pickup ${pickup.pickupCode} on date ${dateKey}`);
  }

  /**
   * Updates cancelled counter in dailystats.
   */
  async recordPickupCancellation(date: Date = new Date(), session?: ClientSession): Promise<void> {
    const dateKey = this.formatDateKey(date);
    await this.statModel.updateOne(
      { date: dateKey, scope: DailyStatScope.OVERALL, refId: null, refKey: null },
      { $inc: { pickupsCancelled: 1 } },
      { upsert: true, session },
    );
  }

  /**
   * Updates failed counter in dailystats.
   */
  async recordPickupFailure(date: Date = new Date(), session?: ClientSession): Promise<void> {
    const dateKey = this.formatDateKey(date);
    await this.statModel.updateOne(
      { date: dateKey, scope: DailyStatScope.OVERALL, refId: null, refKey: null },
      { $inc: { pickupsFailed: 1 } },
      { upsert: true, session },
    );
  }
}
