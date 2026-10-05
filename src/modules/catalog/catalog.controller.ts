import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CatalogService } from './catalog.service.js';
import {
  CreateCategoryDto,
  CreateProductDto,
  SetProductRateDto,
  CreateTimeSlotDto,
  CreateWeightRangeDto,
} from './dto/catalog.dto.js';
import { JwtAuthGuard, Public } from '../../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { Roles, UserRole } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Controller('api/v1')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // --- Public Endpoints for Customer & Employee Apps ---

  @Public()
  @Get('catalog')
  async getFullCatalog() {
    return this.catalogService.getFullCatalog();
  }

  @Public()
  @Get('catalog/categories')
  async getCategories() {
    return this.catalogService.listCategories(true);
  }

  @Public()
  @Get('catalog/products')
  async getProducts(@Query('categoryId') categoryId?: string) {
    return this.catalogService.listProducts(categoryId, true);
  }

  @Public()
  @Get('catalog/slots')
  async getTimeSlots() {
    return this.catalogService.listTimeSlots(true);
  }

  @Public()
  @Get('catalog/weight-ranges')
  async getWeightRanges() {
    return this.catalogService.listWeightRanges(true);
  }

  // --- Admin Endpoints ---

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/catalog/categories')
  async createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalogService.createCategory(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/catalog/products')
  async createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/catalog/rates')
  async setProductRate(
    @Body() dto: SetProductRateDto,
    @CurrentUser() admin: CurrentUserPayload,
  ) {
    return this.catalogService.setProductRate(dto, admin.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/catalog/rates/history/:productId')
  async getRateHistory(@Param('productId') productId: string) {
    return this.catalogService.getRateHistory(productId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/catalog/slots')
  async createTimeSlot(@Body() dto: CreateTimeSlotDto) {
    return this.catalogService.createTimeSlot(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/catalog/weight-ranges')
  async createWeightRange(@Body() dto: CreateWeightRangeDto) {
    return this.catalogService.createWeightRange(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/catalog/seed')
  async seedCatalog(@CurrentUser() admin: CurrentUserPayload) {
    return this.catalogService.seedDefaultCatalog(admin.userId);
  }
}
