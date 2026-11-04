import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';

@Module({
  controllers: [GeoController],
  // useFactory: GeoService takes an optional fetch override (for tests), which Nest must not try to inject.
  providers: [{ provide: GeoService, useFactory: () => new GeoService() }],
  exports: [GeoService],
})
export class GeoModule {}
