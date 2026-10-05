import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScrapCategory, ScrapCategorySchema } from './schemas/scrap-category.schema.js';
import { ScrapProduct, ScrapProductSchema } from './schemas/scrap-product.schema.js';
import { ScrapRate, ScrapRateSchema } from './schemas/scrap-rate.schema.js';
import { TimeSlot, TimeSlotSchema } from './schemas/time-slot.schema.js';
import { WeightRange, WeightRangeSchema } from './schemas/weight-range.schema.js';
import { CatalogService } from './catalog.service.js';
import { CatalogController } from './catalog.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ScrapCategory.name, schema: ScrapCategorySchema },
      { name: ScrapProduct.name, schema: ScrapProductSchema },
      { name: ScrapRate.name, schema: ScrapRateSchema },
      { name: TimeSlot.name, schema: TimeSlotSchema },
      { name: WeightRange.name, schema: WeightRangeSchema },
    ]),
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService, MongooseModule],
})
export class CatalogModule {}
