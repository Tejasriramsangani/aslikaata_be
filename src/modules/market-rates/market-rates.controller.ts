import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { MarketRatesService } from './market-rates.service.js';
import { EnableMarketRateDto, UpdateMarketRateDto } from './dto/market-rate.dto.js';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1/admin/market-rates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class MarketRatesController {
  constructor(private readonly marketRatesService: MarketRatesService) {}

  /** Search + category filter. Enabled items are returned first. */
  @Get()
  list(@Query('search') search?: string, @Query('category') category?: string) {
    return this.marketRatesService.list({ search, category });
  }

  /** Pull the latest rates from the configured live feed (if any). */
  @Post('refresh')
  refresh(@CurrentUser() admin: CurrentUserPayload) {
    return this.marketRatesService.refreshFromFeed(admin.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMarketRateDto,
    @CurrentUser() admin: CurrentUserPayload,
  ) {
    return this.marketRatesService.updateRate(id, dto.ratePerKg, admin.userId);
  }

  @Post(':id/enable')
  enable(
    @Param('id') id: string,
    @Body() dto: EnableMarketRateDto,
    @CurrentUser() admin: CurrentUserPayload,
  ) {
    return this.marketRatesService.enable(id, admin.userId, dto?.discountPercent);
  }

  @Post(':id/disable')
  disable(@Param('id') id: string) {
    return this.marketRatesService.disable(id);
  }
}
