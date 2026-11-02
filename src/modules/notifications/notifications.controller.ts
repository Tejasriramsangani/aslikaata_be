import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

// One inbox controller for both apps. Every query is scoped to the caller's own userId.
@Controller(['api/v1/employee/notifications', 'api/v1/customer/notifications'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.EMPLOYEE, UserRole.CUSTOMER)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('limit') limit?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationsService.list(user.userId, {
      limit: limit ? Number(limit) : undefined,
      unreadOnly: unreadOnly === 'true',
    });
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.unreadCount(user.userId);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Post(':id/read')
  read(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }
}
