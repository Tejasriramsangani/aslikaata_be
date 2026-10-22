import { Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Holiday, HolidayDocument, HolidayHandling, HolidayScope } from '../schemas/holiday.schema.js';
import { RouteRun, RouteRunDocument } from '../schemas/route-run.schema.js';
import { Pickup, PickupDocument } from '../../pickups/schemas/pickup.schema.js';
import { PickupEvent, PickupEventDocument } from '../../pickups/schemas/pickup-event.schema.js';

@Injectable()
export class HolidayService implements OnModuleInit {
  private readonly logger = new Logger(HolidayService.name);

  constructor(
    @InjectModel(Holiday.name)
    private readonly holidayModel: Model<HolidayDocument>,
    @InjectModel(RouteRun.name)
    private readonly routeRunModel: Model<RouteRunDocument>,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(PickupEvent.name)
    private readonly eventModel: Model<PickupEventDocument>,
  ) {}

  async onModuleInit() {
    const count = await this.holidayModel.countDocuments();
    if (count === 0) {
      this.logger.log('Seeding initial operations holidays into MongoDB...');
      await this.holidayModel.insertMany([
        {
          name: 'Gandhi Jayanti',
          date: '2026-10-02',
          type: 'NATIONAL',
          scope: HolidayScope.ALL,
          scopeDescription: 'All Network Divisions & Fleet',
          handling: HolidayHandling.NEXT_WORKING_DAY,
          affectedRunsCount: 8,
          affectedPickupsCount: 52,
          shiftedToDate: '2026-10-03',
          isConfirmed: true,
        },
        {
          name: 'Vijayadasami / Dussehra Holiday',
          date: '2026-10-19',
          type: 'STATE_REGIONAL',
          scope: HolidayScope.ALL,
          scopeDescription: 'All Andhra Pradesh Yards & Routes',
          handling: HolidayHandling.NEXT_WORKING_DAY,
          affectedRunsCount: 10,
          affectedPickupsCount: 68,
          shiftedToDate: '2026-10-20',
          isConfirmed: true,
        },
        {
          name: 'Deepavali Eve Yard Maintenance',
          date: '2026-10-31',
          type: 'YARD_MAINTENANCE',
          scope: HolidayScope.ALL,
          scopeDescription: 'All Processing Yards (Equipment Overhaul)',
          handling: HolidayHandling.NEXT_WORKING_DAY,
          affectedRunsCount: 6,
          affectedPickupsCount: 38,
          shiftedToDate: '2026-11-02',
          isConfirmed: true,
        },
      ]);
      this.logger.log('Seeded 3 operational holidays successfully.');
    }
  }

  async findAll(): Promise<HolidayDocument[]> {
    return this.holidayModel.find().sort({ date: 1 });
  }

  async findByDate(date: string): Promise<HolidayDocument | null> {
    return this.holidayModel.findOne({ date });
  }

  /**
   * Checks if a date is a holiday for a given vehicle and division.
   */
  async isHoliday(date: string, vehicleId?: string, divisionId?: string): Promise<boolean> {
    const holiday = await this.holidayModel.findOne({ date });
    if (!holiday) return false;

    if (holiday.scope === HolidayScope.ALL) return true;

    if (holiday.scope === HolidayScope.VEHICLES && vehicleId) {
      return holiday.vehicleIds.map((v) => v.toString()).includes(vehicleId.toString());
    }

    if (holiday.scope === HolidayScope.DIVISIONS && divisionId) {
      return holiday.divisionIds.map((d) => d.toString()).includes(divisionId.toString());
    }

    return false;
  }

  /**
   * Calculates how many route runs and pickups will be affected before saving a holiday.
   */
  async previewHoliday(data: {
    date: string;
    scope: HolidayScope;
    vehicleIds?: string[];
    divisionIds?: string[];
    handling: HolidayHandling;
  }): Promise<{
    date: string;
    affectedRunsCount: number;
    affectedPickupsCount: number;
    shiftsToDate: string;
  }> {
    const filter: any = { date: data.date };

    if (data.scope === HolidayScope.VEHICLES && data.vehicleIds?.length) {
      filter.vehicleId = { $in: data.vehicleIds };
    } else if (data.scope === HolidayScope.DIVISIONS && data.divisionIds?.length) {
      filter.divisionId = { $in: data.divisionIds };
    }

    const runs = await this.routeRunModel.find(filter);
    const affectedRunsCount = runs.length;

    let affectedPickupsCount = 0;
    for (const r of runs) {
      affectedPickupsCount += r.stops?.length || 0;
    }

    // Determine target shifted date
    const d = new Date(data.date);
    if (data.handling === HolidayHandling.NEXT_WEEK_SAME_DAY) {
      d.setDate(d.getDate() + 7);
    } else {
      d.setDate(d.getDate() + 1); // NEXT_WORKING_DAY default
    }
    const shiftsToDate = d.toISOString().split('T')[0];

    return {
      date: data.date,
      affectedRunsCount,
      affectedPickupsCount,
      shiftsToDate,
    };
  }

  /**
   * Creates a holiday, shifts affected route runs and attached pickups, and records rescheduled_holiday events.
   */
  async createHoliday(
    data: {
      date: string;
      name: string;
      scope: HolidayScope;
      vehicleIds?: string[];
      divisionIds?: string[];
      handling: HolidayHandling;
    },
    adminUserId?: string,
  ): Promise<{ holiday: HolidayDocument; affectedRuns: number; affectedPickups: number }> {
    const holiday = await this.holidayModel.create({
      ...data,
      createdBy: adminUserId,
    });

    const preview = await this.previewHoliday(data);
    const targetDate = preview.shiftsToDate;

    // Shift runs
    const filter: any = { date: data.date };
    if (data.scope === HolidayScope.VEHICLES && data.vehicleIds?.length) {
      filter.vehicleId = { $in: data.vehicleIds };
    } else if (data.scope === HolidayScope.DIVISIONS && data.divisionIds?.length) {
      filter.divisionId = { $in: data.divisionIds };
    }

    const affectedRuns = await this.routeRunModel.find(filter);

    let movedPickupsCount = 0;
    for (const run of affectedRuns) {
      run.originalDate = run.date;
      run.date = targetDate;
      await run.save();

      // Shift attached pickups
      if (run.stops && run.stops.length > 0) {
        for (const stop of run.stops) {
          const pickup = await this.pickupModel.findById(stop.pickupId);
          if (pickup) {
            pickup.scheduledDate = targetDate;
            await pickup.save();
            movedPickupsCount++;

            // Record rescheduled_holiday event
            await this.eventModel.create({
              pickupId: pickup._id.toString(),
              eventType: 'rescheduled_holiday',
              fromStatus: pickup.status,
              toStatus: pickup.status,
              actor: {
                userId: adminUserId || null,
                role: 'ADMIN',
                name: 'Holiday Calendar Shifter',
              },
              payload: {
                holidayName: data.name,
                fromScheduledDate: data.date,
                toScheduledDate: targetDate,
                handling: data.handling,
              },
            });
          }
        }
      }
    }

    return {
      holiday,
      affectedRuns: affectedRuns.length,
      affectedPickups: movedPickupsCount,
    };
  }

  async delete(id: string): Promise<{ success: boolean }> {
    const res = await this.holidayModel.findByIdAndDelete(id);
    if (!res) throw new NotFoundException(`Holiday not found`);
    return { success: true };
  }
}
