import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PickupsService } from './pickups.service.js';
import {
  RequestPickupDto,
  UpdatePreparationDto,
  AssignPickupDto,
  CancelPickupDto,
  FailPickupDto,
  ReschedulePickupDto,
  UpdateCategoriesDto,
} from './dto/pickup.dto.js';
import {
  VerifyQrDto,
  RecordItemsDto,
  ApproveSummaryDto,
} from './dto/field-ops.dto.js';
import { PickupStatus } from './schemas/pickup-status.enum.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PickupsController {
  constructor(private readonly pickupsService: PickupsService) {}

  // --- Customer Endpoints ---

  @Roles(UserRole.CUSTOMER)
  @Post('customer/pickups/request')
  async requestPickup(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RequestPickupDto,
  ) {
    return this.pickupsService.requestPickup(user.userId, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Patch('customer/pickups/:id/preparation')
  async updatePreparation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: UpdatePreparationDto,
  ) {
    return this.pickupsService.updatePreparation(pickupId, user.userId, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Patch('customer/pickups/:id/reschedule')
  async reschedulePickup(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: ReschedulePickupDto,
  ) {
    return this.pickupsService.reschedulePickup(pickupId, user.userId, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Patch('customer/pickups/:id/categories')
  async updateCategories(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: UpdateCategoriesDto,
  ) {
    return this.pickupsService.updateCategories(pickupId, user.userId, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('customer/pickups')
  async listCustomerPickups(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: PickupStatus,
  ) {
    return this.pickupsService.listCustomerPickups(user.userId, status);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('customer/pickups/:id/qr')
  async getQrToken(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.pickupsService.generateQrToken(pickupId, user.userId);
  }

  @Roles(UserRole.CUSTOMER)
  @Get('customer/pickups/:id/summary')
  async getSummary(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.pickupsService.getSummary(pickupId, user.userId);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('customer/pickups/:id/approve')
  async approveSummary(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: ApproveSummaryDto,
  ) {
    return this.pickupsService.approveSummary(pickupId, user.userId, dto);
  }

  @Roles(UserRole.CUSTOMER)
  @Post('customer/pickups/:id/cancel')
  async customerCancelPickup(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: CancelPickupDto,
  ) {
    return this.pickupsService.cancelPickup(pickupId, user.userId, UserRole.CUSTOMER, dto);
  }

  // --- Employee Endpoints ---

  @Roles(UserRole.EMPLOYEE)
  @Get('employee/pickups')
  async listEmployeePickups(
    @CurrentUser() user: CurrentUserPayload,
    @Query('status') status?: PickupStatus,
  ) {
    return this.pickupsService.listEmployeePickups(user.userId, status);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/on-the-way')
  async startJourney(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.pickupsService.startJourney(pickupId, user.userId);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/arrived')
  async markArrived(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.pickupsService.markArrived(pickupId, user.userId);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/verify-qr')
  async verifyQr(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: VerifyQrDto,
  ) {
    return this.pickupsService.verifyQrToken(pickupId, user.userId, dto);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/start')
  async startPickup(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.pickupsService.startPickup(pickupId, user.userId);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/items')
  async recordItems(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: RecordItemsDto,
  ) {
    return this.pickupsService.recordItems(pickupId, user.userId, dto);
  }

  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/fail')
  async failPickup(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: FailPickupDto,
  ) {
    return this.pickupsService.failPickup(pickupId, user.userId, UserRole.EMPLOYEE, dto);
  }

  // --- Admin Endpoints ---

  @Roles(UserRole.ADMIN)
  @Get('admin/pickups')
  async listAdminPickups(
    @Query('status') status?: PickupStatus,
    @Query('date') date?: string,
  ) {
    return this.pickupsService.listAdminPickups(status, date);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/pickups/:id/assign')
  async assignPickup(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: AssignPickupDto,
  ) {
    return this.pickupsService.assignPickup(pickupId, admin.userId, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/pickups/:id/cancel')
  async adminCancelPickup(
    @CurrentUser() admin: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: CancelPickupDto,
  ) {
    return this.pickupsService.cancelPickup(pickupId, admin.userId, UserRole.ADMIN, dto);
  }

  // --- Universal Details Endpoint (with object-level security) ---

  @Get(['pickups/:id', 'customer/pickups/:id'])
  async getPickupById(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.pickupsService.getPickupById(pickupId, user);
  }
}
