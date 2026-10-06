import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SettlementsService } from './settlements.service.js';
import {
  RecordSettlementDto,
  VerifyClosingOtpDto,
  CreateDonationRecipientDto,
} from './dto/settlement.dto.js';
import { JwtAuthGuard, Public } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  // --- Employee Settlement & Gate 3 Endpoints ---

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/settle')
  async recordSettlement(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: RecordSettlementDto,
  ) {
    return this.settlementsService.recordSettlement(pickupId, user.userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/verify-closing-otp')
  async verifyClosingOtp(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: VerifyClosingOtpDto,
  ) {
    return this.settlementsService.verifyClosingOtpAndComplete(pickupId, user.userId, dto);
  }

  // --- Customer Endpoints ---

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.CUSTOMER)
  @Post('customer/pickups/:id/resend-closing-otp')
  async resendClosingOtp(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.settlementsService.resendClosingOtp(pickupId, user.userId);
  }

  // --- Invoice Retrieval (Customer & Admin) ---

  @UseGuards(JwtAuthGuard)
  @Get('pickups/:id/invoice')
  async getInvoice(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
  ) {
    return this.settlementsService.getInvoiceForPickup(pickupId, user);
  }

  // --- Donation Recipients ---

  @Public()
  @Get('catalog/donation-recipients')
  async listDonationRecipients() {
    return this.settlementsService.listDonationRecipients();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/donation-recipients')
  async createDonationRecipient(@Body() dto: CreateDonationRecipientDto) {
    return this.settlementsService.createDonationRecipient(dto);
  }
}
