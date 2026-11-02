import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Matches } from 'class-validator';
import { PickerRequestsService } from './picker-requests.service.js';
import {
  CreatePickerRequestDto,
  ListPickerRequestsQuery,
  RejectPickerRequestDto,
} from './dto/picker-request.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { StaffAccess, StaffRole } from '../../common/decorators/staff-access.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

class StatusQuery {
  @Matches(/^[6-9]\d{9}$/, { message: 'Mobile number must be a valid 10-digit Indian number' })
  mobile: string;
}

/** Public: used by the employee app's login screen (the applicant has no account yet, so no token). */
@Controller('api/v1/picker-requests')
export class PickerRequestsPublicController {
  constructor(private readonly service: PickerRequestsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  submit(@Body() dto: CreatePickerRequestDto, @Req() req: Request) {
    return this.service.submit(dto, req.ip);
  }

  @Get('status')
  status(@Query() query: StatusQuery) {
    return this.service.getStatus(query.mobile);
  }
}

@Controller('api/v1/admin/picker-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@StaffAccess({ read: [StaffRole.DISPATCHER], write: [StaffRole.DISPATCHER] })
export class PickerRequestsAdminController {
  constructor(private readonly service: PickerRequestsService) {}

  @Get()
  list(@Query() query: ListPickerRequestsQuery) {
    return this.service.list(query);
  }

  /** Sidebar badge: every staff role may see how many requests are waiting. */
  @Get('pending-count')
  @StaffAccess({ read: [StaffRole.DISPATCHER, StaffRole.YARD_MANAGER, StaffRole.ACCOUNTANT] })
  pendingCount() {
    return this.service.pendingCount();
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(@Param('id') id: string, @CurrentUser() admin: CurrentUserPayload) {
    return this.service.approve(id, { userId: admin.userId });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectPickerRequestDto,
    @CurrentUser() admin: CurrentUserPayload,
  ) {
    return this.service.reject(id, dto.reason, { userId: admin.userId });
  }
}
