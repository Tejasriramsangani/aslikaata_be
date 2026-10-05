import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomerProfile, CustomerProfileDocument } from './schemas/customer-profile.schema.js';
import { Address, AddressDocument } from './schemas/address.schema.js';
import { UpdateCustomerProfileDto, CreateAddressDto } from './dto/customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(
    @InjectModel(CustomerProfile.name)
    private readonly profileModel: Model<CustomerProfileDocument>,
    @InjectModel(Address.name)
    private readonly addressModel: Model<AddressDocument>,
  ) {}

  async getProfile(userId: string): Promise<CustomerProfileDocument | null> {
    return this.profileModel.findOne({ userId });
  }

  async updateProfile(userId: string, dto: UpdateCustomerProfileDto): Promise<CustomerProfileDocument> {
    return this.profileModel.findOneAndUpdate(
      { userId },
      {
        fullName: dto.fullName,
        email: dto.email || null,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
  }

  async listAddresses(userId: string): Promise<AddressDocument[]> {
    return this.addressModel.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  }

  async addAddress(userId: string, dto: CreateAddressDto): Promise<AddressDocument> {
    // If setting as default or if this is the user's first address, ensure it is default
    const existingCount = await this.addressModel.countDocuments({ userId });
    const isFirstAddress = existingCount === 0;
    const shouldBeDefault = dto.isDefault || isFirstAddress;

    if (shouldBeDefault) {
      await this.addressModel.updateMany({ userId }, { isDefault: false });
    }

    return this.addressModel.create({
      userId,
      line1: dto.line1,
      line2: dto.line2 || '',
      city: dto.city,
      state: dto.state,
      pincode: dto.pincode,
      location: {
        type: 'Point',
        coordinates: dto.coordinates, // [lng, lat]
      },
      isDefault: shouldBeDefault,
      landmark: dto.landmark || null,
    });
  }

  async deleteAddress(userId: string, addressId: string): Promise<boolean> {
    const res = await this.addressModel.findOneAndDelete({ _id: addressId, userId });
    if (!res) {
      throw new NotFoundException('Address not found');
    }
    return true;
  }
}
