import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IdentityService } from './identity.service.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';

@Controller('api/v1/admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly identityService: IdentityService) {}

  @Get()
  async getAdminUsers() {
    return this.identityService.getAdminUsers();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createAdminUser(
    @Body()
    dto: {
      name: string;
      email: string;
      mobile: string;
      role: string;
      password?: string;
      assignedDivision?: string;
    },
  ) {
    return this.identityService.createAdminUser(dto);
  }

  @Delete(':id')
  async deleteAdminUser(@Param('id') id: string) {
    return this.identityService.deleteAdminUser(id);
  }
}
