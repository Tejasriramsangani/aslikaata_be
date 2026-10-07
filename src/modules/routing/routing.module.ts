import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Division, DivisionSchema } from './schemas/division.schema.js';
import { Vehicle, VehicleSchema } from './schemas/vehicle.schema.js';
import { RouteSchedule, RouteScheduleSchema } from './schemas/route-schedule.schema.js';
import { Holiday, HolidaySchema } from './schemas/holiday.schema.js';
import { RouteRun, RouteRunSchema } from './schemas/route-run.schema.js';
import { AppSetting, AppSettingSchema } from './schemas/app-setting.schema.js';

import { AppSettingsService } from './services/app-settings.service.js';
import { OrderClassificationService } from './services/order-classification.service.js';
import { DivisionService } from './services/division.service.js';
import { VehicleService } from './services/vehicle.service.js';
import { RouteScheduleService } from './services/route-schedule.service.js';
import { HolidayService } from './services/holiday.service.js';
import { RouteRunsService } from './services/route-runs.service.js';
import { BulkAutoAssignService } from './services/bulk-auto-assign.service.js';
import { AvailabilityService } from './services/availability.service.js';

import { AvailabilityController } from './controllers/availability.controller.js';
import { AdminRoutingController } from './controllers/admin-routing.controller.js';
import { EmployeeRouteController } from './controllers/employee-route.controller.js';

import { Pickup, PickupSchema } from '../pickups/schemas/pickup.schema.js';
import { PickupEvent, PickupEventSchema } from '../pickups/schemas/pickup-event.schema.js';
import { Address, AddressSchema } from '../customers/schemas/address.schema.js';
import { WeightRange, WeightRangeSchema } from '../catalog/schemas/weight-range.schema.js';
import { TimeSlot, TimeSlotSchema } from '../catalog/schemas/time-slot.schema.js';
import { EmployeeProfile, EmployeeProfileSchema } from '../employees/schemas/employee-profile.schema.js';
import { EmployeeDocument, EmployeeDocumentSchema } from '../employees/schemas/employee-document.schema.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { PickupsModule } from '../pickups/pickups.module.js';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    forwardRef(() => PickupsModule),
    MongooseModule.forFeature([
      { name: Division.name, schema: DivisionSchema },
      { name: Vehicle.name, schema: VehicleSchema },
      { name: RouteSchedule.name, schema: RouteScheduleSchema },
      { name: Holiday.name, schema: HolidaySchema },
      { name: RouteRun.name, schema: RouteRunSchema },
      { name: AppSetting.name, schema: AppSettingSchema },
      { name: Pickup.name, schema: PickupSchema },
      { name: PickupEvent.name, schema: PickupEventSchema },
      { name: Address.name, schema: AddressSchema },
      { name: WeightRange.name, schema: WeightRangeSchema },
      { name: TimeSlot.name, schema: TimeSlotSchema },
      { name: EmployeeProfile.name, schema: EmployeeProfileSchema },
      { name: EmployeeDocument.name, schema: EmployeeDocumentSchema },
    ]),
    CatalogModule,
    RealtimeModule,
  ],
  controllers: [
    AvailabilityController,
    AdminRoutingController,
    EmployeeRouteController,
  ],
  providers: [
    AppSettingsService,
    OrderClassificationService,
    DivisionService,
    VehicleService,
    RouteScheduleService,
    HolidayService,
    RouteRunsService,
    BulkAutoAssignService,
    AvailabilityService,
  ],
  exports: [
    AppSettingsService,
    OrderClassificationService,
    DivisionService,
    VehicleService,
    RouteScheduleService,
    HolidayService,
    RouteRunsService,
    BulkAutoAssignService,
    AvailabilityService,
  ],
})
export class RoutingModule {}
