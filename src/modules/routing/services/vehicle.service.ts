import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Vehicle, VehicleDocument } from '../schemas/vehicle.schema.js';

@Injectable()
export class VehicleService {
  constructor(
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
  ) {}

  async create(data: {
    registrationNumber: string;
    name: string;
    vehicleType: string;
    capacityKg: number;
    maxStops: number;
    status?: any;
    defaultEmployeeId?: string;
  }): Promise<VehicleDocument> {
    const reg = data.registrationNumber.toUpperCase().trim();
    const existing = await this.vehicleModel.findOne({ registrationNumber: reg });
    if (existing) {
      throw new ConflictException(`Vehicle with registration ${reg} already exists`);
    }

    return this.vehicleModel.create({
      ...data,
      registrationNumber: reg,
    });
  }

  async findAll(): Promise<VehicleDocument[]> {
    return this.vehicleModel.find().populate('defaultEmployeeId').sort({ name: 1 });
  }

  async findById(id: string): Promise<VehicleDocument> {
    const vehicle = await this.vehicleModel.findById(id).populate('defaultEmployeeId');
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }
    return vehicle;
  }

  async update(id: string, data: Partial<Vehicle>): Promise<VehicleDocument> {
    if (data.registrationNumber) {
      data.registrationNumber = data.registrationNumber.toUpperCase().trim();
    }
    const vehicle = await this.vehicleModel.findByIdAndUpdate(id, data, { new: true });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }
    return vehicle;
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const res = await this.vehicleModel.findByIdAndDelete(id);
    if (!res) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }
    return { success: true };
  }
}
