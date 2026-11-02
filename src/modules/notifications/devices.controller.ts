import { Body, Controller, Delete, Post, UseGuards } from '@nestjs/common';
import { PushService } from './push.service.js';
import { RegisterDeviceDto, UnregisterDeviceDto } from './dto/device.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

/** Push-token registration, shared by the customer and employee apps. */
@Controller('api/v1/devices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER, UserRole.EMPLOYEE)
export class DevicesController {
  constructor(private readonly pushService: PushService) {}

  /** Call after login and whenever FCM rotates the token. Idempotent. */
  @Post()
  register(@CurrentUser() user: CurrentUserPayload, @Body() dto: RegisterDeviceDto) {
    return this.pushService.registerToken(user.userId, dto);
  }

  /** Call on logout so the next person on this phone does not get the previous user's pushes. */
  @Delete()
  unregister(@CurrentUser() user: CurrentUserPayload, @Body() dto: UnregisterDeviceDto) {
    return this.pushService.unregisterToken(user.userId, dto.token);
  }
}
