import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OrderClassificationService } from './order-classification.service.js';
import { DivisionService } from './division.service.js';
import { RouteScheduleService } from './route-schedule.service.js';
import { HolidayService } from './holiday.service.js';
import { Address, AddressDocument } from '../../customers/schemas/address.schema.js';
import { WeightRange, WeightRangeDocument } from '../../catalog/schemas/weight-range.schema.js';
import { TimeSlot, TimeSlotDocument } from '../../catalog/schemas/time-slot.schema.js';
import { Pickup, PickupDocument } from '../../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../../pickups/schemas/pickup-status.enum.js';

export interface AvailabilityResponse {
  mode: 'SLOTS' | 'ROUTE_DAYS';
  helperText?: string;
  outOfCoverage?: boolean;
  slotsMode?: {
    dates: Array<{
      iso: string;
      label: string;
      dayNum: number;
      monthStr: string;
      weekday: string;
    }>;
    timeSlots: Array<{
      id: string;
      period: 'morning' | 'afternoon' | 'evening';
      displayLabel: string;
      startTime: string;
      endTime: string;
      isAvailable: boolean;
    }>;
  };
  routeDaysMode?: {
    dates: Array<{
      iso: string;
      weekday: string;
      dayNum: number;
      monthStr: string;
      windowLabel: string; // e.g. "9:00 AM – 1:00 PM"
      startTime: string;
      endTime: string;
      routeScheduleId?: string;
    }>;
    divisionName?: string;
  };
}

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    @InjectModel(Address.name)
    private readonly addressModel: Model<AddressDocument>,
    @InjectModel(WeightRange.name)
    private readonly weightRangeModel: Model<WeightRangeDocument>,
    @InjectModel(TimeSlot.name)
    private readonly timeSlotModel: Model<TimeSlotDocument>,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    private readonly classificationService: OrderClassificationService,
    private readonly divisionService: DivisionService,
    private readonly routeScheduleService: RouteScheduleService,
    private readonly holidayService: HolidayService,
  ) {}

  async getAvailability(addressId: string, weightRangeId: string): Promise<AvailabilityResponse> {
    const address = await this.addressModel.findById(addressId);
    if (!address) {
      throw new NotFoundException(`Address with ID ${addressId} not found`);
    }

    const weightRange = await this.weightRangeModel.findById(weightRangeId);
    if (!weightRange) {
      throw new NotFoundException(`Weight range with ID ${weightRangeId} not found`);
    }

    // 1. Classify order as BULK or WEEKLY
    const classification = await this.classificationService.classify({
      minGrams: weightRange.minGrams,
      maxGrams: weightRange.maxGrams,
    });

    if (classification.orderType === 'BULK') {
      return this.getBulkSlotsAvailability();
    } else {
      return this.getWeeklyRouteDaysAvailability(address);
    }
  }

  /**
   * Generates next 7 days and available time slots with capacity check.
   */
  private async getBulkSlotsAvailability(): Promise<AvailabilityResponse> {
    const today = new Date();
    const dates = [];

    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const iso = d.toISOString().split('T')[0];
      const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      const monthStr = d.toLocaleDateString('en-US', { month: 'short' });
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday;

      dates.push({ iso, label, dayNum, monthStr, weekday });
    }

    const allSlots = await this.timeSlotModel.find({ isActive: true }).sort({ startTime: 1 });

    const formattedSlots = allSlots.map((s) => {
      const startHour = parseInt(s.startTime.split(':')[0], 10);
      let period: 'morning' | 'afternoon' | 'evening' = 'morning';
      if (startHour >= 12 && startHour < 17) period = 'afternoon';
      else if (startHour >= 17) period = 'evening';

      return {
        id: s._id.toString(),
        period,
        displayLabel: s.displayLabel,
        startTime: s.startTime,
        endTime: s.endTime,
        isAvailable: true,
      };
    });

    return {
      mode: 'SLOTS',
      slotsMode: {
        dates,
        timeSlots: formattedSlots,
      },
    };
  }

  /**
   * Generates next 2-3 route collection days for the customer's division with holidays applied.
   */
  private async getWeeklyRouteDaysAvailability(address: AddressDocument): Promise<AvailabilityResponse> {
    const division = await this.divisionService.findDivisionForAddress({
      pincode: address.pincode,
      location: address.location,
    });

    if (!division) {
      return {
        mode: 'ROUTE_DAYS',
        outOfCoverage: true,
        helperText: 'We will confirm a collection day for your area shortly.',
        routeDaysMode: {
          dates: [],
        },
      };
    }

    const schedules = await this.routeScheduleService.findByDivision(division._id.toString());
    if (!schedules.length) {
      return {
        mode: 'ROUTE_DAYS',
        outOfCoverage: true,
        helperText: 'We will confirm a collection day for your area shortly.',
        routeDaysMode: {
          dates: [],
          divisionName: division.name,
        },
      };
    }

    const scheduledWeekdays = new Set(schedules.map((s) => s.weekday));

    const today = new Date();
    const candidateDates = [];

    // Scan next 21 days to find next 3 non-holiday schedule days
    for (let i = 1; i <= 21; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const jsDay = d.getDay();
      const weekdayNum = jsDay === 0 ? 7 : jsDay;

      if (scheduledWeekdays.has(weekdayNum)) {
        const iso = d.toISOString().split('T')[0];

        // Match schedule for window
        const sched = schedules.find((s) => s.weekday === weekdayNum);
        const vehicleId = (sched?.vehicleId as any)?._id?.toString() || (sched?.vehicleId as any)?.toString();

        const isHol = await this.holidayService.isHoliday(
          iso,
          vehicleId,
          division._id.toString(),
        );

        if (!isHol) {
          const weekdayStr = d.toLocaleDateString('en-US', { weekday: 'short' });
          const dayNum = d.getDate();
          const monthStr = d.toLocaleDateString('en-US', { month: 'short' });

          candidateDates.push({
            iso,
            weekday: weekdayStr,
            dayNum,
            monthStr,
            windowLabel: `${sched?.windowStart || '09:00'} – ${sched?.windowEnd || '13:00'}`,
            startTime: sched?.windowStart || '09:00',
            endTime: sched?.windowEnd || '13:00',
            routeScheduleId: sched?._id?.toString(),
          });

          if (candidateDates.length >= 3) {
            break;
          }
        }
      }
    }

    return {
      mode: 'ROUTE_DAYS',
      helperText: 'We collect from your area on these days.',
      routeDaysMode: {
        dates: candidateDates,
        divisionName: division.name,
      },
    };
  }
}
