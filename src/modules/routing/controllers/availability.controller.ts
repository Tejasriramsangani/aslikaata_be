import { Controller, Get, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { AvailabilityService } from '../services/availability.service.js';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard.js';

import { Public } from '../../../common/guards/jwt-auth.guard.js';

@Controller('api/v1/availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Public()
  @Get()
  async getAvailability(
    @Query('addressId') addressId: string,
    @Query('weightRangeId') weightRangeId: string,
  ) {
    if (!addressId || !weightRangeId) {
      throw new BadRequestException('Both addressId and weightRangeId query parameters are required');
    }

    return this.availabilityService.getAvailability(addressId, weightRangeId);
  }
}
