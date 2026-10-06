import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmployeeProfile, EmployeeProfileSchema } from './schemas/employee-profile.schema.js';
import { EmployeeDocument, EmployeeDocumentSchema } from './schemas/employee-document.schema.js';
import { AuditLog, AuditLogSchema } from '../../common/audit/audit-log.schema.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { EmployeesService } from './employees.service.js';
import { EmployeesController } from './employees.controller.js';

@Module({
  imports: [
    OutboxModule,
    MongooseModule.forFeature([
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: EmployeeDocument.name, schema: EmployeeDocumentSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [EmployeesController],
  providers: [EmployeesService],
  exports: [EmployeesService, MongooseModule],
})
export class EmployeesModule {}
