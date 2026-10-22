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
import { JwtAuthGuard, Public } from '../../common/guards/jwt-auth.guard.js';

@Controller('api/v1/admin/users')
export class AdminUsersController {
  constructor(private readonly identityService: IdentityService) {}

  @Public() // Allow reading in ops / protected via header
  @Get()
  async getAdminUsers() {
    return this.identityService.getAdminUsers();
  }

  @Public()
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

  @Public()
  @Delete(':id')
  async deleteAdminUser(@Param('id') id: string) {
    return this.identityService.deleteAdminUser(id);
  }
}
