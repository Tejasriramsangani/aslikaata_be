import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { RouteRun, RouteRunDocument, RouteRunStatus } from '../schemas/route-run.schema.js';
import { RouteSchedule, RouteScheduleDocument } from '../schemas/route-schedule.schema.js';
import { Vehicle, VehicleDocument } from '../schemas/vehicle.schema.js';
import { HolidayService } from './holiday.service.js';
import { Pickup, PickupDocument } from '../../pickups/schemas/pickup.schema.js';
import { PickupEvent, PickupEventDocument } from '../../pickups/schemas/pickup-event.schema.js';
import { PickupStatus } from '../../pickups/schemas/pickup-status.enum.js';

@Injectable()
export class RouteRunsService {
  private readonly logger = new Logger(RouteRunsService.name);

  constructor(
    @InjectModel(RouteRun.name)
    private readonly routeRunModel: Model<RouteRunDocument>,
    @InjectModel(RouteSchedule.name)
    private readonly scheduleModel: Model<RouteScheduleDocument>,
    @InjectModel(Vehicle.name)
    private readonly vehicleModel: Model<VehicleDocument>,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(PickupEvent.name)
    private readonly eventModel: Model<PickupEventDocument>,
    private readonly holidayService: HolidayService,
  ) {}

  /**
   * Generates route runs for the next 14 days based on active RouteSchedules,
   * skipping or adjusting dates that fall on a holiday.
   */
  async generateRunsForNext14Days(): Promise<{ createdCount: number }> {
    const schedules = await this.scheduleModel.find({ isActive: true });
    let createdCount = 0;

    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];

      // Convert JS getDay() (0=Sun, 1=Mon, ..., 6=Sat) to Weekday (1=Mon ... 7=Sun)
      const jsDay = d.getDay();
      const weekday = jsDay === 0 ? 7 : jsDay;

      // Find schedules matching this weekday
      const matchingSchedules = schedules.filter((s) => s.weekday === weekday);

      for (const sched of matchingSchedules) {
        // Check if date is a holiday for this vehicle or division
        const isHol = await this.holidayService.isHoliday(
          dateStr,
          sched.vehicleId.toString(),
          sched.divisionId.toString(),
        );
        if (isHol) {
          continue; // Holiday skipping/shifting handled by HolidayService
        }

        // Check if run already exists for this date, vehicle, and division
        const existing = await this.routeRunModel.findOne({
          date: dateStr,
          vehicleId: sched.vehicleId,
          divisionId: sched.divisionId,
        });

        if (!existing) {
          await this.routeRunModel.create({
            date: dateStr,
            vehicleId: sched.vehicleId,
            divisionId: sched.divisionId,
            employeeProfileId: sched.defaultEmployeeId || null,
            status: RouteRunStatus.PLANNED,
            windowStart: sched.windowStart,
            windowEnd: sched.windowEnd,
            stops: [],
            usedKg: 0,
            usedStops: 0,
          });
          createdCount++;
        }
      }
    }

    return { createdCount };
  }

  /**
   * Places a WEEKLY pickup into the earliest upcoming route run for its division with capacity.
   */
  async placeWeeklyPickup(pickup: PickupDocument, divisionId: string): Promise<RouteRunDocument | null> {
    await this.generateRunsForNext14Days();

    const plannedMaxKg = (pickup.estimatedWeightSnapshot?.maxGrams || 20000) / 1000;

    // Find upcoming planned/finalized runs for this division ordered by date
    const runs = await this.routeRunModel
      .find({
        divisionId,
        status: { $in: [RouteRunStatus.PLANNED, RouteRunStatus.FINALIZED] },
      })
      .sort({ date: 1 });

    for (const run of runs) {
      const vehicle = await this.vehicleModel.findById(run.vehicleId);
      const capacityKg = vehicle?.capacityKg || 500;
      const maxStops = vehicle?.maxStops || 20;

      // Check remaining capacity and stops
      if (run.usedKg + plannedMaxKg <= capacityKg && run.usedStops < maxStops) {
        const nextSeq = run.stops.length + 1;

        run.stops.push({
          pickupId: pickup._id.toString(),
          sequence: nextSeq,
          plannedMaxKg,
          status: 'SCHEDULED',
        });
        run.usedKg += plannedMaxKg;
        run.usedStops += 1;
        await run.save();

        // Update Pickup
        pickup.routeRunId = run._id.toString();
        pickup.divisionId = divisionId;
        pickup.stopSequence = nextSeq;
        pickup.scheduledDate = run.date;
        pickup.timeSlotSnapshot = {
          startTime: run.windowStart,
          endTime: run.windowEnd,
          displayLabel: `${run.windowStart} – ${run.windowEnd}`,
        };
        pickup.status = PickupStatus.SCHEDULED;
        pickup.timestamps.scheduledAt = new Date();
        await pickup.save();

        // Record placed_in_run event
        await this.eventModel.create({
          pickupId: pickup._id.toString(),
          eventType: 'placed_in_run',
          fromStatus: PickupStatus.REQUESTED,
          toStatus: PickupStatus.SCHEDULED,
          actor: {
            userId: null,
            role: 'SYSTEM',
            name: 'Route Runs Scheduler',
          },
          payload: {
            routeRunId: run._id.toString(),
            divisionId,
            date: run.date,
            stopSequence: nextSeq,
            window: `${run.windowStart} – ${run.windowEnd}`,
          },
        });

        return run;
      }
    }

    // No run had capacity, mark pickup for admin review
    pickup.divisionId = divisionId;
    pickup.needsAdminReview = true;
    await pickup.save();

    return null;
  }

  /**
   * Finalizes route runs for a specific date (usually run the evening before):
   * Fixes employee & vehicle, transitions attached pickups from SCHEDULED to ASSIGNED.
   */
  async finalizeRunsForDate(date: string): Promise<{ finalizedRuns: number; assignedPickups: number }> {
    const runs = await this.routeRunModel.find({
      date,
      status: RouteRunStatus.PLANNED,
    });

    let assignedPickups = 0;
    for (const run of runs) {
      const vehicle = await this.vehicleModel.findById(run.vehicleId);

      run.status = RouteRunStatus.FINALIZED;
      await run.save();

      // Move each pickup to ASSIGNED
      for (const stop of run.stops) {
        const p = await this.pickupModel.findById(stop.pickupId);
        if (p && p.status === PickupStatus.SCHEDULED) {
          p.status = PickupStatus.ASSIGNED;
          p.timestamps.assignedAt = new Date();
          p.assignment = {
            employeeProfileId: run.employeeProfileId || 'admin_assigned',
            employeeCode: 'ROUTE-CREW',
            employeeName: 'Route Collection Executive',
            vehicleType: vehicle?.vehicleType || 'VAN',
            vehicleNumber: vehicle?.registrationNumber || 'AP 16 TE 4092',
            assignedAt: new Date(),
            assignedBy: 'SYSTEM_ROUTE_FINALIZER',
            method: 'ROUTE',
          };
          await p.save();
          assignedPickups++;

          await this.eventModel.create({
            pickupId: p._id.toString(),
            eventType: 'route_finalized',
            fromStatus: PickupStatus.SCHEDULED,
            toStatus: PickupStatus.ASSIGNED,
            actor: {
              userId: null,
              role: 'SYSTEM',
              name: 'Evening Route Finalizer',
            },
            payload: {
              routeRunId: run._id.toString(),
              vehicleNumber: vehicle?.registrationNumber,
              stopSequence: stop.sequence,
            },
          });
        }
      }
    }

    return { finalizedRuns: runs.length, assignedPickups };
  }

  /**
   * Returns today's active route run and ordered stops for the authenticated employee.
   */
  async getTodayRouteForEmployee(employeeProfileId: string, dateStr?: string): Promise<any> {
    const date = dateStr || new Date().toISOString().split('T')[0];

    const run = await this.routeRunModel
      .findOne({
        employeeProfileId,
        date,
        status: { $in: [RouteRunStatus.FINALIZED, RouteRunStatus.IN_PROGRESS] },
      })
      .populate('vehicleId')
      .populate('divisionId');

    if (!run) {
      return {
        hasRouteToday: false,
        message: 'No route assigned for today.',
      };
    }

    // Populate pickups for each stop
    const stopDetails = [];
    for (const stop of run.stops) {
      const pickup = await this.pickupModel
        .findById(stop.pickupId)
        .select('pickupCode customerId addressSnapshot estimatedWeightSnapshot settlementPreference status totals');
      stopDetails.push({
        sequence: stop.sequence,
        plannedMaxKg: stop.plannedMaxKg,
        stopStatus: stop.status,
        pickup,
      });
    }

    return {
      hasRouteToday: true,
      routeRunId: run._id,
      date: run.date,
      status: run.status,
      window: `${run.windowStart} – ${run.windowEnd}`,
      vehicle: run.vehicleId,
      division: run.divisionId,
      usedKg: run.usedKg,
      totalStops: run.stops.length,
      stops: stopDetails,
    };
  }

  async findRunsByDate(date: string): Promise<RouteRunDocument[]> {
    return this.routeRunModel
      .find({ date })
      .populate('vehicleId')
      .populate('divisionId')
      .populate('employeeProfileId')
      .sort({ windowStart: 1 });
  }

  async patchRun(
    id: string,
    dto: {
      employeeProfileId?: string;
      status?: RouteRunStatus;
      reorderStops?: Array<{ pickupId: string; sequence: number }>;
    },
  ): Promise<RouteRunDocument> {
    const run = await this.routeRunModel.findById(id);
    if (!run) throw new NotFoundException(`Route run with ID ${id} not found`);

    if (dto.employeeProfileId !== undefined) {
      run.employeeProfileId = dto.employeeProfileId;
    }
    if (dto.status !== undefined) {
      run.status = dto.status;
    }
    if (dto.reorderStops && dto.reorderStops.length) {
      const stopMap = new Map(run.stops.map((s) => [s.pickupId.toString(), s]));
      for (const r of dto.reorderStops) {
        const found = stopMap.get(r.pickupId.toString());
        if (found) {
          found.sequence = r.sequence;
        }
      }
      run.stops.sort((a, b) => a.sequence - b.sequence);
    }

    await run.save();
    return run;
  }
}
