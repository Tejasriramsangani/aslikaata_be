import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CustomerProfile, CustomerProfileSchema } from './schemas/customer-profile.schema.js';
import { Address, AddressSchema } from './schemas/address.schema.js';
import { CustomersService } from './customers.service.js';
import { CustomersController } from './customers.controller.js';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CustomerProfile.name, schema: CustomerProfileSchema },
      { name: Address.name, schema: AddressSchema },
    ]),
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService, MongooseModule],
})
export class CustomersModule {}
