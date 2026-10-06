import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DailyStat, DailyStatSchema } from './schemas/daily-stat.schema.js';
import { Pickup, PickupSchema } from '../pickups/schemas/pickup.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';
import { DailyStatsService } from './daily-stats.service.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsController } from './analytics.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DailyStat.name, schema: DailyStatSchema },
      { name: Pickup.name, schema: PickupSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
    ]),
  ],
  controllers: [AnalyticsController],
  providers: [DailyStatsService, AnalyticsService],
  exports: [DailyStatsService, AnalyticsService, MongooseModule],
})
export class AnalyticsModule {}
