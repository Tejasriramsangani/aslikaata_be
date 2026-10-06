import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { DatabaseModule } from './common/database/database.module.js';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

import { IdentityModule } from './modules/identity/identity.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { PickupsModule } from './modules/pickups/pickups.module.js';
import { SettlementsModule } from './modules/settlements/settlements.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { AuditModule } from './modules/audit/audit.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    IdentityModule,
    CustomersModule,
    EmployeesModule,
    CatalogModule,
    PickupsModule,
    SettlementsModule,
    RealtimeModule,
    OutboxModule,
    AnalyticsModule,
    AuditModule,
  ],
  controllers: [],
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
