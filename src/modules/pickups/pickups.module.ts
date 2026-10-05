import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Pickup, PickupSchema } from './schemas/pickup.schema.js';
import { PickupEvent, PickupEventSchema } from './schemas/pickup-event.schema.js';
import { Address, AddressSchema } from '../customers/schemas/address.schema.js';
import { TimeSlot, TimeSlotSchema } from '../catalog/schemas/time-slot.schema.js';
import { WeightRange, WeightRangeSchema } from '../catalog/schemas/weight-range.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';
import { EmployeeDocument, EmployeeDocumentSchema } from '../employees/schemas/employee-document.schema.js';

import { PickupStateMachineService } from './pickup-state-machine.service.js';
import { PickupsService } from './pickups.service.js';
import { PickupsController } from './pickups.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Pickup.name, schema: PickupSchema },
      { name: PickupEvent.name, schema: PickupEventSchema },
      { name: Address.name, schema: AddressSchema },
      { name: TimeSlot.name, schema: TimeSlotSchema },
      { name: WeightRange.name, schema: WeightRangeSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: EmployeeDocument.name, schema: EmployeeDocumentSchema },
    ]),
  ],
  controllers: [PickupsController],
  providers: [PickupStateMachineService, PickupsService],
  exports: [PickupsService, PickupStateMachineService, MongooseModule],
})
export class PickupsModule {}
