import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OutboxEvent, OutboxEventSchema } from '../../common/outbox/outbox-event.schema.js';
import { Pickup, PickupSchema } from '../pickups/schemas/pickup.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';
import { OutboxService } from './outbox.service.js';
import { OutboxController } from './outbox.controller.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [
    RealtimeModule,
    MongooseModule.forFeature([
      { name: OutboxEvent.name, schema: OutboxEventSchema },
      { name: Pickup.name, schema: PickupSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
    ]),
  ],
  controllers: [OutboxController],
  providers: [OutboxService],
  exports: [OutboxService, MongooseModule],
})
export class OutboxModule {}
