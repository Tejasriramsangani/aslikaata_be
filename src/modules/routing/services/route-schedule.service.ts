import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RouteSchedule, RouteScheduleDocument } from '../schemas/route-schedule.schema.js';

@Injectable()
export class RouteScheduleService {
  constructor(
    @InjectModel(RouteSchedule.name)
    private readonly scheduleModel: Model<RouteScheduleDocument>,
  ) {}

  async create(data: {
    vehicleId: string;
    divisionId: string;
    weekday: number;
    windowStart?: string;
    windowEnd?: string;
    defaultEmployeeId?: string;
    effectiveFrom?: Date;
    effectiveTo?: Date;
    isActive?: boolean;
  }): Promise<RouteScheduleDocument> {
    const effectiveFrom = data.effectiveFrom || new Date();
    const existing = await this.scheduleModel.findOne({
      vehicleId: data.vehicleId,
      weekday: data.weekday,
      effectiveFrom,
    });
    if (existing) {
      throw new ConflictException(
        `Vehicle already has a schedule for weekday ${data.weekday} starting from ${effectiveFrom.toISOString()}`,
      );
    }

    return this.scheduleModel.create({
      ...data,
      effectiveFrom,
      windowStart: data.windowStart || '09:00',
      windowEnd: data.windowEnd || '13:00',
      isActive: data.isActive !== undefined ? data.isActive : true,
    });
  }

  async findAll(): Promise<RouteScheduleDocument[]> {
    return this.scheduleModel
      .find()
      .populate('vehicleId')
      .populate('divisionId')
      .populate('defaultEmployeeId')
      .sort({ weekday: 1 });
  }

  async findByDivision(divisionId: string): Promise<RouteScheduleDocument[]> {
    return this.scheduleModel
      .find({ divisionId, isActive: true })
      .populate('vehicleId')
      .sort({ weekday: 1 });
  }

  async findByVehicle(vehicleId: string): Promise<RouteScheduleDocument[]> {
    return this.scheduleModel
      .find({ vehicleId, isActive: true })
      .populate('divisionId')
      .sort({ weekday: 1 });
  }

  async findById(id: string): Promise<RouteScheduleDocument> {
    const s = await this.scheduleModel.findById(id).populate('vehicleId').populate('divisionId');
    if (!s) {
      throw new NotFoundException(`Route schedule with ID ${id} not found`);
    }
    return s;
  }

  async update(id: string, data: Partial<RouteSchedule>): Promise<RouteScheduleDocument> {
    const s = await this.scheduleModel.findByIdAndUpdate(id, data, { new: true });
    if (!s) {
      throw new NotFoundException(`Route schedule with ID ${id} not found`);
    }
    return s;
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const res = await this.scheduleModel.findByIdAndDelete(id);
    if (!res) {
      throw new NotFoundException(`Route schedule with ID ${id} not found`);
    }
    return { success: true };
  }
}
