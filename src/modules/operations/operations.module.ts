import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { FuelLog, FuelLogSchema } from './schemas/fuel-log.schema.js';
import { MaintenanceLog, MaintenanceLogSchema } from './schemas/maintenance-log.schema.js';
import { IncidentalLog, IncidentalLogSchema } from './schemas/incidental-log.schema.js';
import { InwardVoucher, InwardVoucherSchema } from './schemas/inward-voucher.schema.js';
import { YardReconciliation, YardReconciliationSchema } from './schemas/yard-reconciliation.schema.js';
import { CashFloat, CashFloatSchema } from './schemas/cash-float.schema.js';
import { YardStock, YardStockSchema } from './schemas/yard-stock.schema.js';
import { OutwardDispatch, OutwardDispatchSchema } from './schemas/outward-dispatch.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';

import { OperationsService } from './operations.service.js';
import { OperationsController } from './operations.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FuelLog.name, schema: FuelLogSchema },
      { name: MaintenanceLog.name, schema: MaintenanceLogSchema },
      { name: IncidentalLog.name, schema: IncidentalLogSchema },
      { name: InwardVoucher.name, schema: InwardVoucherSchema },
      { name: YardReconciliation.name, schema: YardReconciliationSchema },
      { name: CashFloat.name, schema: CashFloatSchema },
      { name: YardStock.name, schema: YardStockSchema },
      { name: OutwardDispatch.name, schema: OutwardDispatchSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
    ]),
  ],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
