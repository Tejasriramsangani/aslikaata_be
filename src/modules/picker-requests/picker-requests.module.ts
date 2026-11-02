import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PickerRequest, PickerRequestSchema } from './schemas/picker-request.schema.js';
import { User, UserSchema } from '../identity/schemas/user.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';
import { AuditLog, AuditLogSchema } from '../../common/audit/audit-log.schema.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PickerRequestsService } from './picker-requests.service.js';
import {
  PickerRequestsAdminController,
  PickerRequestsPublicController,
} from './picker-requests.controller.js';

@Module({
  imports: [
    IdentityModule, // exports SMS_SERVICE and the AdminCredential model
    NotificationsModule,
    MongooseModule.forFeature([
      { name: PickerRequest.name, schema: PickerRequestSchema },
      { name: User.name, schema: UserSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
  ],
  controllers: [PickerRequestsPublicController, PickerRequestsAdminController],
  providers: [PickerRequestsService],
  exports: [PickerRequestsService],
})
export class PickerRequestsModule {}
