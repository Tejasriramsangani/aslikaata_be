import { Injectable, Logger } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service.js';

export interface ClassificationResult {
  orderType: 'BULK' | 'WEEKLY';
  limitKgApplied: number;
  rangeMinKg: number;
  rangeMaxKg: number;
  decidedAt: Date;
}

@Injectable()
export class OrderClassificationService {
  private readonly logger = new Logger(OrderClassificationService.name);

  constructor(private readonly appSettingsService: AppSettingsService) {}

  /**
   * Classifies an order based on the selected weight range and current bulkLimitKg setting.
   * Default rule: order is BULK when minKg >= bulkLimitKg; otherwise WEEKLY.
   */
  async classify(weightRange: {
    minGrams?: number;
    maxGrams?: number;
  }): Promise<ClassificationResult> {
    const bulkLimitKg = await this.appSettingsService.getBulkLimitKg();

    const rangeMinKg = (weightRange.minGrams || 0) / 1000;
    const rangeMaxKg = (weightRange.maxGrams || 0) / 1000;

    const orderType: 'BULK' | 'WEEKLY' =
      rangeMinKg >= bulkLimitKg ? 'BULK' : 'WEEKLY';

    return {
      orderType,
      limitKgApplied: bulkLimitKg,
      rangeMinKg,
      rangeMaxKg,
      decidedAt: new Date(),
    };
  }

  /**
   * Evaluates all weight ranges against a given bulk limit to generate the admin rule preview.
   */
  previewClassification(
    bulkLimitKg: number,
    ranges: Array<{ id: string; name: string; displayLabel: string; minGrams: number; maxGrams: number }>,
  ): Array<{
    id: string;
    displayLabel: string;
    minKg: number;
    maxKg: number;
    orderType: 'BULK' | 'WEEKLY';
    isBoundaryAligned: boolean;
  }> {
    return ranges.map((r) => {
      const minKg = r.minGrams / 1000;
      const maxKg = r.maxGrams / 1000;
      const orderType: 'BULK' | 'WEEKLY' = minKg >= bulkLimitKg ? 'BULK' : 'WEEKLY';
      // Checks whether bulkLimit aligns with range boundary
      const isBoundaryAligned = bulkLimitKg === minKg || bulkLimitKg === maxKg;
      return {
        id: r.id,
        displayLabel: r.displayLabel,
        minKg,
        maxKg,
        orderType,
        isBoundaryAligned,
      };
    });
  }
}
