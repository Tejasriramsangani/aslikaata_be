import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service.js';
import { UpdateCustomerProfileDto, CreateAddressDto } from './dto/customer.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1/customer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CUSTOMER)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: CurrentUserPayload) {
    return this.customersService.getProfile(user.userId);
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateCustomerProfileDto,
  ) {
    return this.customersService.updateProfile(user.userId, dto);
  }

  @Get('addresses')
  async listAddresses(@CurrentUser() user: CurrentUserPayload) {
    return this.customersService.listAddresses(user.userId);
  }

  @Post('addresses')
  async addAddress(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateAddressDto,
  ) {
    return this.customersService.addAddress(user.userId, dto);
  }

  @Delete('addresses/:id')
  async deleteAddress(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') addressId: string,
  ) {
    return this.customersService.deleteAddress(user.userId, addressId);
  }
}
