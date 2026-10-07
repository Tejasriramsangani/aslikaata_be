import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppSetting, AppSettingDocument } from '../schemas/app-setting.schema.js';

@Injectable()
export class AppSettingsService {
  private readonly logger = new Logger(AppSettingsService.name);

  constructor(
    @InjectModel(AppSetting.name)
    private readonly settingModel: Model<AppSettingDocument>,
  ) {}

  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    const setting = await this.settingModel.findOne({ key });
    if (!setting || setting.value === undefined || setting.value === null) {
      return defaultValue;
    }
    return setting.value as T;
  }

  async setSetting(key: string, value: any, description?: string): Promise<AppSettingDocument> {
    return this.settingModel.findOneAndUpdate(
      { key },
      { value, ...(description ? { description } : {}) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  async getBulkLimitKg(): Promise<number> {
    return this.getSetting<number>('bulkLimitKg', 10);
  }

  async getOrderRules(): Promise<{
    bulkLimitKg: number;
    routeFinalizeHoursBefore: number;
    autoAssignRetryMinutes: number;
    maxPickupsPerEmployeeSlot: number;
  }> {
    const [bulkLimitKg, routeFinalizeHoursBefore, autoAssignRetryMinutes, maxPickupsPerEmployeeSlot] =
      await Promise.all([
        this.getSetting<number>('bulkLimitKg', 10),
        this.getSetting<number>('routeFinalizeHoursBefore', 18),
        this.getSetting<number>('autoAssignRetryMinutes', 5),
        this.getSetting<number>('maxPickupsPerEmployeeSlot', 4),
      ]);

    return {
      bulkLimitKg,
      routeFinalizeHoursBefore,
      autoAssignRetryMinutes,
      maxPickupsPerEmployeeSlot,
    };
  }

  async updateOrderRules(dto: {
    bulkLimitKg?: number;
    routeFinalizeHoursBefore?: number;
    autoAssignRetryMinutes?: number;
    maxPickupsPerEmployeeSlot?: number;
  }): Promise<any> {
    if (dto.bulkLimitKg !== undefined) {
      await this.setSetting('bulkLimitKg', dto.bulkLimitKg, 'Bulk threshold in KG');
    }
    if (dto.routeFinalizeHoursBefore !== undefined) {
      await this.setSetting('routeFinalizeHoursBefore', dto.routeFinalizeHoursBefore, 'Hours before route to finalize');
    }
    if (dto.autoAssignRetryMinutes !== undefined) {
      await this.setSetting('autoAssignRetryMinutes', dto.autoAssignRetryMinutes, 'Auto assign retry interval in minutes');
    }
    if (dto.maxPickupsPerEmployeeSlot !== undefined) {
      await this.setSetting('maxPickupsPerEmployeeSlot', dto.maxPickupsPerEmployeeSlot, 'Max pickups per employee slot');
    }

    return this.getOrderRules();
  }
}
