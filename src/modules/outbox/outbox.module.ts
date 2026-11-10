import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OutboxEvent, OutboxEventSchema } from '../../common/outbox/outbox-event.schema.js';
import { Pickup, PickupSchema } from '../pickups/schemas/pickup.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';
import { OutboxService } from './outbox.service.js';
import { OutboxController } from './outbox.controller.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { User, UserSchema } from '../identity/schemas/user.schema.js';
import { CustomerProfile, CustomerProfileSchema } from '../customers/schemas/customer-profile.schema.js';
import { Settlement, SettlementSchema } from '../settlements/schemas/settlement.schema.js';
import { WhatsappNotificationsService } from '../notifications/whatsapp-notifications.service.js';
import { WhatsappWebhookController } from '../notifications/whatsapp-webhook.controller.js';

@Module({
  imports: [
    RealtimeModule,
    NotificationsModule,
    IdentityModule,
    MongooseModule.forFeature([
      { name: OutboxEvent.name, schema: OutboxEventSchema },
      { name: Pickup.name, schema: PickupSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: User.name, schema: UserSchema },
      { name: CustomerProfile.name, schema: CustomerProfileSchema },
      { name: Settlement.name, schema: SettlementSchema },
    ]),
  ],
  controllers: [OutboxController, WhatsappWebhookController],
  providers: [OutboxService, WhatsappNotificationsService],
  exports: [OutboxService, MongooseModule],
})
export class OutboxModule {}
