import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLog, AuditLogSchema } from '../../common/audit/audit-log.schema.js';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: AuditLog.name, schema: AuditLogSchema }]),
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService, MongooseModule],
})
export class AuditModule {}
