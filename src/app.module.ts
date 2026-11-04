import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from './common/database/database.module.js';
import { validateEnv } from './common/config/validate-env.js';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

import { IdentityModule } from './modules/identity/identity.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { MarketRatesModule } from './modules/market-rates/market-rates.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PickerRequestsModule } from './modules/picker-requests/picker-requests.module.js';
import { PickupsModule } from './modules/pickups/pickups.module.js';
import { SettlementsModule } from './modules/settlements/settlements.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { OperationsModule } from './modules/operations/operations.module.js';
import { GeoModule } from './modules/geo/geo.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';

import { AppController } from './app.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IdentityModule,
    CustomersModule,
    EmployeesModule,
    CatalogModule,
    MarketRatesModule,
    NotificationsModule,
    PickerRequestsModule,
    PickupsModule,
    SettlementsModule,
    RealtimeModule,
    OutboxModule,
    AnalyticsModule,
    AuditModule,
    RoutingModule,
    OperationsModule,
    GeoModule,
    UploadsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiResponseInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
