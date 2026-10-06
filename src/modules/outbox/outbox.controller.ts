import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OutboxService } from './outbox.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { LocationUpdateDto } from './dto/location-update.dto.js';
import { OutboxStatus } from '../../common/outbox/outbox-event.schema.js';
import { Pickup, PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../pickups/schemas/pickup-status.enum.js';
import { EmployeeProfile, EmployeeProfileDocument } from '../employees/schemas/employee-profile.schema.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OutboxController {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly realtimeGateway: RealtimeGateway,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
  ) {}

  /**
   * Flow Step 3: Employee streams live GPS coordinates while traveling.
   * Section 8 Guard: location is visible to customer ONLY while pickup status is ON_THE_WAY.
   */
  @Roles(UserRole.EMPLOYEE)
  @Post('employee/pickups/:id/location')
  async reportEmployeeLocation(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') pickupId: string,
    @Body() dto: LocationUpdateDto,
  ) {
    const employee = await this.employeeProfileModel.findOne({ userId: user.userId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (pickup.status !== PickupStatus.ON_THE_WAY) {
      throw new BadRequestException(
        `Location can only be streamed while pickup is ON_THE_WAY. Current status is ${pickup.status}.`,
      );
    }

    const locationPayload = {
      pickupId,
      employeeId: employee._id.toString(),
      employeeName: employee.fullName,
      coordinates: [dto.longitude, dto.latitude],
      speed: dto.speed || null,
      heading: dto.heading || null,
      updatedAt: new Date(),
    };

    // Broadcasts to pickup room (customer) and admin dashboard
    this.realtimeGateway.emitEmployeeLocation(pickupId, locationPayload);

    return { success: true, message: 'Location broadcasted successfully' };
  }

  // --- Admin Outbox Monitoring ---

  @Roles(UserRole.ADMIN)
  @Get('admin/outbox')
  async listOutboxEvents(@Query('status') status?: OutboxStatus) {
    return this.outboxService.listEvents(status);
  }

  @Roles(UserRole.ADMIN)
  @Post('admin/outbox/process')
  async triggerProcessing() {
    return this.outboxService.processPendingEvents();
  }
}
