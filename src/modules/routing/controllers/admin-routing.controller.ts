import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { DivisionService } from '../services/division.service.js';
import { VehicleService } from '../services/vehicle.service.js';
import { RouteScheduleService } from '../services/route-schedule.service.js';
import { HolidayService } from '../services/holiday.service.js';
import { RouteRunsService } from '../services/route-runs.service.js';
import { AppSettingsService } from '../services/app-settings.service.js';
import { OrderClassificationService } from '../services/order-classification.service.js';
import { CatalogService } from '../../catalog/catalog.service.js';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Pickup, PickupDocument } from '../../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../../pickups/schemas/pickup-status.enum.js';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminRoutingController {
  constructor(
    private readonly divisionService: DivisionService,
    private readonly vehicleService: VehicleService,
    private readonly routeScheduleService: RouteScheduleService,
    private readonly holidayService: HolidayService,
    private readonly routeRunsService: RouteRunsService,
    private readonly appSettingsService: AppSettingsService,
    private readonly classificationService: OrderClassificationService,
    private readonly catalogService: CatalogService,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
  ) {}

  // --- Order Rules & Bulk Limit (Section 2 & 9) ---
  @Get('order-rules')
  async getOrderRules() {
    const rules = await this.appSettingsService.getOrderRules();
    const weightRanges = await this.catalogService.listWeightRanges(false);

    const formattedRanges = weightRanges.map((w: any) => ({
      id: w._id.toString(),
      name: w.name,
      displayLabel: w.displayLabel,
      minGrams: w.minGrams,
      maxGrams: w.maxGrams,
    }));

    const preview = this.classificationService.previewClassification(
      rules.bulkLimitKg,
      formattedRanges,
    );

    return {
      rules,
      rangesPreview: preview,
    };
  }

  @Put('order-rules')
  async updateOrderRules(
    @Body()
    body: {
      bulkLimitKg?: number;
      routeFinalizeHoursBefore?: number;
      autoAssignRetryMinutes?: number;
      maxPickupsPerEmployeeSlot?: number;
    },
  ) {
    return this.appSettingsService.updateOrderRules(body);
  }

  // --- Divisions CRUD (Section 5 & 9) ---
  @Get('divisions')
  async listDivisions() {
    return this.divisionService.findAll();
  }

  @Post('divisions')
  async createDivision(
    @Body()
    body: {
      name: string;
      code: string;
      pincodes?: string[];
      boundary?: any;
      isActive?: boolean;
    },
  ) {
    if (!body.name || !body.code) {
      throw new BadRequestException('Name and code are required for division');
    }
    return this.divisionService.create(body);
  }

  @Put('divisions/:id')
  async updateDivision(@Param('id') id: string, @Body() body: any) {
    return this.divisionService.update(id, body);
  }

  @Delete('divisions/:id')
  async deleteDivision(@Param('id') id: string) {
    return this.divisionService.delete(id);
  }

  // --- Vehicles CRUD (Section 5 & 9) ---
  @Get('vehicles')
  async listVehicles() {
    return this.vehicleService.findAll();
  }

  @Post('vehicles')
  async createVehicle(
    @Body()
    body: {
      registrationNumber: string;
      name: string;
      vehicleType: string;
      capacityKg: number;
      maxStops: number;
      defaultEmployeeId?: string;
    },
  ) {
    return this.vehicleService.create(body);
  }

  @Put('vehicles/:id')
  async updateVehicle(@Param('id') id: string, @Body() body: any) {
    return this.vehicleService.update(id, body);
  }

  @Delete('vehicles/:id')
  async deleteVehicle(@Param('id') id: string) {
    return this.vehicleService.delete(id);
  }

  // --- Route Schedules CRUD (Section 5 & 9) ---
  @Get('route-schedules')
  async listRouteSchedules() {
    return this.routeScheduleService.findAll();
  }

  @Post('route-schedules')
  async createRouteSchedule(@Body() body: any) {
    return this.routeScheduleService.create(body);
  }

  @Put('route-schedules/:id')
  async updateRouteSchedule(@Param('id') id: string, @Body() body: any) {
    return this.routeScheduleService.update(id, body);
  }

  @Delete('route-schedules/:id')
  async deleteRouteSchedule(@Param('id') id: string) {
    return this.routeScheduleService.delete(id);
  }

  // --- Holidays CRUD & Preview (Section 5 & 9) ---
  @Get('holidays')
  async listHolidays() {
    return this.holidayService.findAll();
  }

  @Post('holidays/preview')
  async previewHoliday(@Body() body: any) {
    if (!body.date) {
      throw new BadRequestException('Date is required for preview');
    }
    return this.holidayService.previewHoliday(body);
  }

  @Post('holidays')
  async createHoliday(@Body() body: any, @CurrentUser() user: any) {
    if (!body.date || !body.name) {
      throw new BadRequestException('Date and name are required for holiday');
    }
    return this.holidayService.createHoliday(body, user?._id?.toString());
  }

  @Delete('holidays/:id')
  async deleteHoliday(@Param('id') id: string) {
    return this.holidayService.delete(id);
  }

  // --- Route Runs (Section 5, 8 & 9) ---
  @Get('route-runs')
  async listRouteRuns(@Query('date') date: string) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    return this.routeRunsService.findRunsByDate(targetDate);
  }

  @Post('route-runs/generate')
  async generateRuns() {
    return this.routeRunsService.generateRunsForNext14Days();
  }

  @Post('route-runs/finalize')
  async finalizeRuns(@Query('date') date: string) {
    const targetDate = date || new Date().toISOString().split('T')[0];
    return this.routeRunsService.finalizeRunsForDate(targetDate);
  }

  @Patch('route-runs/:id')
  async patchRouteRun(@Param('id') id: string, @Body() body: any) {
    return this.routeRunsService.patchRun(id, body);
  }

  // --- Unassigned Queue (Section 4, 8 & 9) ---
  @Get('pickups/unassigned')
  async getUnassignedQueue() {
    return this.pickupModel
      .find({
        $or: [{ unassigned: true }, { needsAdminReview: true }],
        status: { $in: [PickupStatus.REQUESTED, PickupStatus.SCHEDULED] },
      })
      .sort({ createdAt: -1 });
  }
}
