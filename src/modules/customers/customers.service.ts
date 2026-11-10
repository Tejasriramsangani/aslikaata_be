import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CustomerProfile, CustomerProfileDocument } from './schemas/customer-profile.schema.js';
import { Address, AddressDocument } from './schemas/address.schema.js';
import { UpdateCustomerProfileDto, CreateAddressDto, SaveLocationDto } from './dto/customer.dto.js';

/** A customer keeps up to this many saved addresses (Home, Work and one more). */
export const MAX_SAVED_ADDRESSES = 3;

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
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    );
  }

  async listAddresses(userId: string): Promise<AddressDocument[]> {
    return this.addressModel.find({ userId }).sort({ isDefault: -1, createdAt: -1 });
  }

  /**
   * Remembers where the customer is right now. Called every time the app captures the location (GPS
   * allowed, locality changed, house number typed), so the profile always holds the latest one.
   * Returns saved:false while the customer has no profile yet (the app saves again after the name step).
   */
  async saveLocation(userId: string, dto: SaveLocationDto): Promise<{ saved: boolean; lastLocation: any }> {
    const lastLocation = {
      latitude: dto.latitude,
      longitude: dto.longitude,
      areaName: dto.areaName?.trim() || '',
      city: dto.city?.trim() || '',
      state: dto.state?.trim() || '',
      pincode: dto.pincode || '',
      formattedAddress: dto.formattedAddress?.trim() || '',
      houseNumber: dto.houseNumber?.trim() || '',
      landmark: dto.landmark?.trim() || '',
      updatedAt: new Date(),
    };
    const profile = await this.profileModel.findOneAndUpdate({ userId }, { $set: { lastLocation } }, { returnDocument: 'after' });
    return { saved: !!profile, lastLocation };
  }

  async addAddress(userId: string, dto: CreateAddressDto): Promise<AddressDocument> {
    const houseNumber = dto.houseNumber?.trim() || '';

    // Booking again from the same door must not pile up copies: reuse an address that has the same
    // PIN code and house number and is within ~40 m of this one.
    const [lng, lat] = dto.coordinates;
    const existing = await this.addressModel.findOne({
      userId,
      pincode: dto.pincode,
      // Addresses saved before house numbers existed have no such field: that counts as "no house number".
      houseNumber: houseNumber || { $in: ['', null] },
      location: {
        $near: { $geometry: { type: 'Point', coordinates: [lng, lat] }, $maxDistance: 40 },
      },
    });
    if (existing) {
      // Same door, but the customer may have added or changed the landmark / label since: keep the newest.
      let changed = false;
      const landmark = dto.landmark?.trim();
      if (landmark && landmark !== existing.landmark) {
        existing.landmark = landmark;
        changed = true;
      }
      if (dto.label && dto.label !== existing.label) {
        existing.label = dto.label;
        existing.labelName = dto.label === 'OTHER' ? dto.labelName?.trim() || '' : '';
        changed = true;
      }
      if (changed) await existing.save();
      return existing;
    }

    // If setting as default or if this is the user's first address, ensure it is default
    const existingCount = await this.addressModel.countDocuments({ userId });
    if (existingCount >= MAX_SAVED_ADDRESSES) {
      throw new BadRequestException(
        `You can save up to ${MAX_SAVED_ADDRESSES} addresses. Delete one to add another.`,
      );
    }
    const isFirstAddress = existingCount === 0;
    const shouldBeDefault = dto.isDefault || isFirstAddress;

    if (shouldBeDefault) {
      await this.addressModel.updateMany({ userId }, { isDefault: false });
    }

    return this.addressModel.create({
      userId,
      line1: dto.line1,
      line2: dto.line2 || '',
      houseNumber,
      label: dto.label || 'OTHER',
      labelName: dto.label === 'OTHER' ? dto.labelName?.trim() || '' : '',
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

  /** Makes one address the primary (default) one; the others stop being primary. */
  async setPrimaryAddress(userId: string, addressId: string): Promise<AddressDocument> {
    const address = await this.addressModel.findOne({ _id: addressId, userId });
    if (!address) {
      throw new NotFoundException('Address not found');
    }
    await this.addressModel.updateMany({ userId, _id: { $ne: address._id } }, { isDefault: false });
    address.isDefault = true;
    await address.save();
    return address;
  }

  async deleteAddress(userId: string, addressId: string): Promise<boolean> {
    const res = await this.addressModel.findOneAndDelete({ _id: addressId, userId });
    if (!res) {
      throw new NotFoundException('Address not found');
    }
    // Never leave the customer without a primary address: the most recent remaining one takes over.
    if (res.isDefault) {
      const next = await this.addressModel.findOne({ userId }).sort({ createdAt: -1 });
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }
    return true;
  }
}
