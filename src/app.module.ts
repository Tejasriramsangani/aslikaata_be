import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { DatabaseModule } from './common/database/database.module.js';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

import { IdentityModule } from './modules/identity/identity.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { EmployeesModule } from './modules/employees/employees.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { PickupsModule } from './modules/pickups/pickups.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    IdentityModule,
    CustomersModule,
    EmployeesModule,
    CatalogModule,
    PickupsModule,
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
