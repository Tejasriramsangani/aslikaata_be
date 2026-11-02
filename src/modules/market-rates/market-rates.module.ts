import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CatalogModule } from '../catalog/catalog.module.js';
import { MarketRate, MarketRateSchema } from './schemas/market-rate.schema.js';
import { MarketRatesService } from './market-rates.service.js';
import { MarketRatesController } from './market-rates.controller.js';
import { MarketRateFeedProvider } from './providers/market-rate-feed.provider.js';

@Module({
  imports: [
    // CatalogModule exports CatalogService and the Scrap* models.
    CatalogModule,
    MongooseModule.forFeature([{ name: MarketRate.name, schema: MarketRateSchema }]),
  ],
  controllers: [MarketRatesController],
  providers: [MarketRatesService, MarketRateFeedProvider],
})
export class MarketRatesModule {}
