import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Settlement, SettlementSchema } from './schemas/settlement.schema.js';
import { DonationRecipient, DonationRecipientSchema } from './schemas/donation-recipient.schema.js';
import { Invoice, InvoiceSchema } from '../invoices/schemas/invoice.schema.js';
import { Pickup, PickupSchema } from '../pickups/schemas/pickup.schema.js';
import { OtpChallenge, OtpChallengeSchema } from '../identity/schemas/otp-challenge.schema.js';
import { User, UserSchema } from '../identity/schemas/user.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';

import { SettlementsService } from './settlements.service.js';
import { SettlementsController } from './settlements.controller.js';
import { PickupsModule } from '../pickups/pickups.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';

@Module({
  imports: [
    PickupsModule,
    IdentityModule,
    OutboxModule,
    AnalyticsModule,
    MongooseModule.forFeature([
      { name: Settlement.name, schema: SettlementSchema },
      { name: DonationRecipient.name, schema: DonationRecipientSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Pickup.name, schema: PickupSchema },
      { name: OtpChallenge.name, schema: OtpChallengeSchema },
      { name: User.name, schema: UserSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
    ]),
  ],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService, MongooseModule],
})
export class SettlementsModule {}
