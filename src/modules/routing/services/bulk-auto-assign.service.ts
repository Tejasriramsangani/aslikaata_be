import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Pickup, PickupDocument } from '../../pickups/schemas/pickup.schema.js';
import { PickupEvent, PickupEventDocument } from '../../pickups/schemas/pickup-event.schema.js';
import { PickupStatus } from '../../pickups/schemas/pickup-status.enum.js';
import { EmployeeProfile, EmployeeProfileDocument, EmployeeStatus } from '../../employees/schemas/employee-profile.schema.js';
import { EmployeeDocument, EmployeeDocumentDocument, DocumentStatus } from '../../employees/schemas/employee-document.schema.js';
import { AppSettingsService } from './app-settings.service.js';
import { RealtimeGateway } from '../../realtime/realtime.gateway.js';

@Injectable()
export class BulkAutoAssignService {
  private readonly logger = new Logger(BulkAutoAssignService.name);

  constructor(
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(PickupEvent.name)
    private readonly eventModel: Model<PickupEventDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
    @InjectModel(EmployeeDocument.name)
    private readonly employeeDocModel: Model<EmployeeDocumentDocument>,
    private readonly appSettingsService: AppSettingsService,
    @Optional() private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  /**
   * Attempts instant auto-assignment of a BULK pickup to the nearest qualified employee.
   */
  async tryAutoAssign(pickup: PickupDocument): Promise<{ assigned: boolean; employee?: EmployeeProfileDocument }> {
    const rules = await this.appSettingsService.getOrderRules();
    const maxPickupsPerSlot = rules.maxPickupsPerEmployeeSlot;

    // 1. Find all APPROVED employees
    const approvedEmployees = await this.employeeProfileModel.find({
      status: EmployeeStatus.APPROVED,
    });

    if (!approvedEmployees.length) {
      return this.handleNoCandidates(pickup, 'No approved employees found in system');
    }

    const qualifiedCandidates: EmployeeProfileDocument[] = [];

    // 2. Filter employees with active, non-expired verified documents
    for (const emp of approvedEmployees) {
      const hasExpiredDocs = await this.employeeDocModel.exists({
        employeeProfileId: emp._id.toString(),
        status: { $ne: DocumentStatus.VERIFIED },
      });

      if (hasExpiredDocs) {
        continue;
      }

      // Check slot capacity for today
      const assignedCountInSlot = await this.pickupModel.countDocuments({
        'assignment.employeeProfileId': emp._id.toString(),
        scheduledDate: pickup.scheduledDate,
        timeSlotId: pickup.timeSlotId,
        status: { $nin: [PickupStatus.CANCELLED, PickupStatus.FAILED] },
      } as any);

      if (assignedCountInSlot >= maxPickupsPerSlot) {
        continue;
      }

      qualifiedCandidates.push(emp);
    }

    if (!qualifiedCandidates.length) {
      return this.handleNoCandidates(pickup, 'All qualified employees are at capacity for this slot');
    }

    // 3. Rank candidates by fewest pickups today
    const employeeWorkload = await Promise.all(
      qualifiedCandidates.map(async (emp) => {
        const todayCount = await this.pickupModel.countDocuments({
          'assignment.employeeProfileId': emp._id.toString(),
          scheduledDate: pickup.scheduledDate,
          status: { $nin: [PickupStatus.CANCELLED, PickupStatus.FAILED] },
        } as any);
        return { emp, todayCount };
      }),
    );

    employeeWorkload.sort((a, b) => a.todayCount - b.todayCount);
    const chosenEmployee = employeeWorkload[0].emp;

    // 4. Assign the chosen employee
    pickup.assignment = {
      employeeProfileId: chosenEmployee._id.toString(),
      employeeCode: chosenEmployee.employeeCode,
      employeeName: chosenEmployee.fullName,
      vehicleType: chosenEmployee.vehicleType || 'VAN',
      vehicleNumber: chosenEmployee.vehicleNumber || 'AP 16 TE 4092',
      assignedAt: new Date(),
      assignedBy: 'SYSTEM_AUTO_ASSIGN',
      method: 'AUTO',
    };
    pickup.status = PickupStatus.ASSIGNED;
    pickup.timestamps.assignedAt = new Date();
    pickup.unassigned = false;
    await pickup.save();

    // 5. Record auto_assigned event
    await this.eventModel.create({
      pickupId: pickup._id.toString(),
      eventType: 'auto_assigned',
      fromStatus: PickupStatus.REQUESTED,
      toStatus: PickupStatus.ASSIGNED,
      actor: {
        userId: null,
        role: 'SYSTEM',
        name: 'Bulk Instant Auto-Assigner',
      },
      payload: {
        employeeProfileId: chosenEmployee._id.toString(),
        employeeCode: chosenEmployee.employeeCode,
        employeeName: chosenEmployee.fullName,
        method: 'AUTO',
      },
    });

    // Realtime notification
    if (this.realtimeGateway) {
      this.realtimeGateway.notifyPickupStatusChanged(
        pickup._id.toString(),
        PickupStatus.ASSIGNED,
        `Assigned to ${chosenEmployee.fullName}`,
      );
    }

    this.logger.log(`[AutoAssign] Successfully auto-assigned BULK pickup ${pickup.pickupCode} to ${chosenEmployee.employeeCode}`);
    return { assigned: true, employee: chosenEmployee };
  }

  private async handleNoCandidates(pickup: PickupDocument, reason: string): Promise<{ assigned: boolean }> {
    pickup.unassigned = true;
    await pickup.save();

    await this.eventModel.create({
      pickupId: pickup._id.toString(),
      eventType: 'assignment_failed',
      fromStatus: pickup.status,
      toStatus: pickup.status,
      actor: {
        userId: null,
        role: 'SYSTEM',
        name: 'Bulk Instant Auto-Assigner',
      },
      payload: { reason },
    });

    if (this.realtimeGateway) {
      this.realtimeGateway.notifyUnassignedAlert(pickup.pickupCode, reason);
    }

    this.logger.warn(`[AutoAssign] Bulk pickup ${pickup.pickupCode} unassigned: ${reason}`);
    return { assigned: false };
  }

  /**
   * Retries unassigned pickups (used by scheduler cron).
   */
  async retryUnassignedPickups(): Promise<{ retried: number; assignedCount: number }> {
    const unassigned = await this.pickupModel.find({
      unassigned: true,
      status: PickupStatus.REQUESTED,
    });

    let assignedCount = 0;
    for (const p of unassigned) {
      const res = await this.tryAutoAssign(p);
      if (res.assigned) assignedCount++;
    }

    return { retried: unassigned.length, assignedCount };
  }
}
