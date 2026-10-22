import { Injectable, NotFoundException, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Vehicle, VehicleDocument } from '../schemas/vehicle.schema.js';

@Injectable()
export class VehicleService implements OnModuleInit {
  private readonly logger = new Logger(VehicleService.name);

  constructor(
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
  ) {}

  async onModuleInit() {
    const count = await this.vehicleModel.countDocuments();
    if (count === 0) {
      this.logger.log('Seeding initial operational fleet into MongoDB...');
      await this.vehicleModel.insertMany([
        {
          registrationNumber: 'AP 16 TX 4021',
          name: 'Piaggio Ape E-City EV 01',
          vehicleType: 'EV_AUTO',
          ownership: 'OWNED',
          ownershipDetails: { assetValueRupees: 380000, rentalChargeRupees: 0 },
          capacityKg: 500,
          maxStops: 18,
          compliance: {
            fitnessValidUntil: '2027-04-15',
            insuranceValidUntil: '2027-02-10',
            pucValidUntil: '2026-11-20',
            lastServiceOdometer: 14200,
          },
          currentOdometer: 15480,
          assignedDivision: 'Vijayawada Central',
          defaultDriver: { name: 'Ramesh Kumar', phone: '9876543210' },
          status: 'ACTIVE',
        },
        {
          registrationNumber: 'AP 16 TE 9081',
          name: 'Mahindra Zor Grand EV 02',
          vehicleType: 'EV_AUTO',
          ownership: 'OWNED',
          ownershipDetails: { assetValueRupees: 420000, rentalChargeRupees: 0 },
          capacityKg: 600,
          maxStops: 22,
          compliance: {
            fitnessValidUntil: '2027-08-30',
            insuranceValidUntil: '2026-10-25',
            pucValidUntil: '2027-03-12',
            lastServiceOdometer: 8900,
          },
          currentOdometer: 10250,
          assignedDivision: 'Vijayawada East',
          defaultDriver: { name: 'Siva Krishna', phone: '9440112233' },
          status: 'ACTIVE',
        },
        {
          registrationNumber: 'AP 16 TF 2234',
          name: 'Tata Ace Gold (Diesel) - Rented 01',
          vehicleType: 'TATA_ACE',
          ownership: 'RENTED',
          ownershipDetails: {
            vendorName: 'Sri Balaji Commercial Fleet',
            vendorPhone: '9848123456',
            rentBillingModel: 'DAILY_FLAT',
            rentalChargeRupees: 750,
            contractValidUntil: '2026-12-31',
          },
          capacityKg: 1000,
          maxStops: 15,
          compliance: {
            fitnessValidUntil: '2027-01-20',
            insuranceValidUntil: '2027-01-15',
            pucValidUntil: '2026-12-05',
            lastServiceOdometer: 48000,
          },
          currentOdometer: 51200,
          assignedDivision: 'Vijayawada Central',
          defaultDriver: { name: 'K. Venkatesh', phone: '9988776655' },
          status: 'ACTIVE',
        },
        {
          registrationNumber: 'AP 07 TJ 1120',
          name: 'Ape Auto Diesel - Rented 02',
          vehicleType: 'DIESEL_AUTO',
          ownership: 'RENTED',
          ownershipDetails: {
            vendorName: 'Amaravati Logistics Partner',
            vendorPhone: '9700334455',
            rentBillingModel: 'MONTHLY_FIXED',
            rentalChargeRupees: 16500,
            contractValidUntil: '2027-03-31',
          },
          capacityKg: 550,
          maxStops: 16,
          compliance: {
            fitnessValidUntil: '2027-05-15',
            insuranceValidUntil: '2027-04-10',
            pucValidUntil: '2026-11-28',
            lastServiceOdometer: 31000,
          },
          currentOdometer: 33400,
          assignedDivision: 'Guntur Hub',
          defaultDriver: { name: 'Md. Ismail', phone: '9849556677' },
          status: 'ACTIVE',
        },
      ]);
      this.logger.log('Seeded 4 live fleet vehicles successfully.');
    }
  }

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
