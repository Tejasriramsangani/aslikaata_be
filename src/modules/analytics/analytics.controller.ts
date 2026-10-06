import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';

@Controller('api/v1/admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Task 7.1.3: Real-time operational snapshot of today.
   */
  @Get('today')
  async getTodayMetrics() {
    return this.analyticsService.getTodayMetrics();
  }

  /**
   * Task 7.1.3: Historical trends from dailystats.
   */
  @Get('trends')
  async getTrends(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.getTrends(startDate, endDate);
  }

  /**
   * Task 7.1.3: Employee performance metrics & high wastage fraud detection.
   */
  @Get('employees')
  async getEmployeeAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('threshold') threshold?: string,
  ) {
    const thresholdNum = threshold ? parseFloat(threshold) : 15;
    return this.analyticsService.getEmployeeAnalytics(startDate, endDate, thresholdNum);
  }

  /**
   * Task 7.1.3: Pincode regional scrap demand distribution.
   */
  @Get('pincodes')
  async getPincodeAnalytics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.analyticsService.getPincodeAnalytics(startDate, endDate);
  }
}
