import { Injectable, NotFoundException, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Division, DivisionDocument } from '../schemas/division.schema.js';

@Injectable()
export class DivisionService implements OnModuleInit {
  private readonly logger = new Logger(DivisionService.name);

  constructor(
    @InjectModel(Division.name)
    private readonly divisionModel: Model<DivisionDocument>,
  ) {}

  async onModuleInit() {
    const count = await this.divisionModel.countDocuments();
    if (count === 0) {
      this.logger.log('Seeding initial operations divisions into MongoDB...');
      await this.divisionModel.insertMany([
        {
          name: 'Vijayawada Central Yard (MG Road, Benz Circle)',
          code: 'VJA_C',
          pincodes: ['520001', '520002', '520010'],
          isActive: true,
        },
        {
          name: 'Vijayawada East (Madhura Nagar, Currency Nagar)',
          code: 'VJA_E',
          pincodes: ['520007', '520008', '520011'],
          isActive: true,
        },
        {
          name: 'Guntur Processing Yard (Autonagar)',
          code: 'GNT_01',
          pincodes: ['522001', '522004', '522006'],
          isActive: true,
        },
      ]);
      this.logger.log('Seeded 3 operational divisions successfully.');
    }
  }

  async create(data: {
    name: string;
    code: string;
    pincodes?: string[];
    boundary?: any;
    isActive?: boolean;
  }): Promise<DivisionDocument> {
    const existing = await this.divisionModel.findOne({ code: data.code.toUpperCase() });
    if (existing) {
      throw new ConflictException(`Division with code ${data.code} already exists`);
    }

    return this.divisionModel.create({
      ...data,
      code: data.code.toUpperCase(),
      isActive: data.isActive !== undefined ? data.isActive : true,
    });
  }

  async findAll(onlyActive = false): Promise<DivisionDocument[]> {
    const query = onlyActive ? { isActive: true } : {};
    return this.divisionModel.find(query).sort({ name: 1 });
  }

  async findById(id: string): Promise<DivisionDocument> {
    const division = await this.divisionModel.findById(id);
    if (!division) {
      throw new NotFoundException(`Division with ID ${id} not found`);
    }
    return division;
  }

  async update(id: string, data: Partial<Division>): Promise<DivisionDocument> {
    const division = await this.divisionModel.findByIdAndUpdate(id, data, { new: true });
    if (!division) {
      throw new NotFoundException(`Division with ID ${id} not found`);
    }
    return division;
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const res = await this.divisionModel.findByIdAndDelete(id);
    if (!res) {
      throw new NotFoundException(`Division with ID ${id} not found`);
    }
    return { success: true };
  }

  /**
   * Resolves an address to a division:
   * 1. By GeoJSON polygon first ($geoIntersects) if coordinates exist.
   * 2. By pincode second.
   */
  async findDivisionForAddress(address: {
    pincode?: string;
    location?: { coordinates: number[] };
  }): Promise<DivisionDocument | null> {
    // 1. Polygon match
    if (address.location?.coordinates && address.location.coordinates.length === 2) {
      const [lng, lat] = address.location.coordinates;
      if (lng && lat) {
        const polygonMatch = await this.divisionModel.findOne({
          isActive: true,
          boundary: {
            $geoIntersects: {
              $geometry: {
                type: 'Point',
                coordinates: [lng, lat],
              },
            },
          },
        });
        if (polygonMatch) return polygonMatch;
      }
    }

    // 2. Pincode match
    if (address.pincode) {
      const pincodeMatch = await this.divisionModel.findOne({
        isActive: true,
        pincodes: address.pincode.trim(),
      });
      if (pincodeMatch) return pincodeMatch;
    }

    return null;
  }
}
