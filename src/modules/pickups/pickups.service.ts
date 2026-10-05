import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Pickup, PickupDocument } from './schemas/pickup.schema.js';
import { PickupStatus } from './schemas/pickup-status.enum.js';
import { PickupStateMachineService } from './pickup-state-machine.service.js';
import {
  RequestPickupDto,
  UpdatePreparationDto,
  AssignPickupDto,
  CancelPickupDto,
  FailPickupDto,
} from './dto/pickup.dto.js';
import { SequenceService } from '../../common/database/sequence.service.js';
import { Address, AddressDocument } from '../customers/schemas/address.schema.js';
import { TimeSlot, TimeSlotDocument } from '../catalog/schemas/time-slot.schema.js';
import { WeightRange, WeightRangeDocument } from '../catalog/schemas/weight-range.schema.js';
import {
  EmployeeProfile,
  EmployeeProfileDocument,
  EmployeeStatus,
} from '../employees/schemas/employee-profile.schema.js';
import {
  EmployeeDocument,
  EmployeeDocumentDocument,
  DocumentStatus,
} from '../employees/schemas/employee-document.schema.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';

@Injectable()
export class PickupsService {
  private readonly logger = new Logger(PickupsService.name);

  constructor(
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(Address.name)
    private readonly addressModel: Model<AddressDocument>,
    @InjectModel(TimeSlot.name)
    private readonly slotModel: Model<TimeSlotDocument>,
    @InjectModel(WeightRange.name)
    private readonly weightRangeModel: Model<WeightRangeDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
    @InjectModel(EmployeeDocument.name)
    private readonly employeeDocModel: Model<EmployeeDocumentDocument>,
    private readonly stateMachine: PickupStateMachineService,
    private readonly sequenceService: SequenceService,
  ) {}

  /**
   * Customer requests a pickup. Creates record and schedules it if capacity allows.
   */
  async requestPickup(customerId: string, dto: RequestPickupDto): Promise<PickupDocument> {
    // 1. Verify and snapshot Address
    const address = await this.addressModel.findOne({ _id: dto.addressId, userId: customerId });
    if (!address) {
      throw new NotFoundException('Selected address not found');
    }

    // 2. Verify and snapshot TimeSlot
    const slot = await this.slotModel.findById(dto.timeSlotId);
    if (!slot || !slot.isActive) {
      throw new NotFoundException('Selected time slot not available');
    }

    // Check slot booking capacity for the requested date
    const bookedCount = await this.pickupModel.countDocuments({
      scheduledDate: dto.scheduledDate,
      timeSlotId: dto.timeSlotId,
      status: { $nin: [PickupStatus.CANCELLED, PickupStatus.FAILED] },
    });

    if (bookedCount >= slot.maxPickups) {
      throw new BadRequestException('Selected time slot is fully booked for this date. Please choose another slot.');
    }

    // 3. Verify and snapshot WeightRange
    const weightRange = await this.weightRangeModel.findById(dto.estimatedWeightRangeId);
    if (!weightRange || !weightRange.isActive) {
      throw new NotFoundException('Selected weight range not available');
    }

    // 4. Generate human-readable sequential code (AK-10001)
    const pickupCode = await this.sequenceService.generatePickupCode();

    const pickup = await this.pickupModel.create({
      pickupCode,
      customerId,
      addressSnapshot: {
        line1: address.line1,
        line2: address.line2 || '',
        city: address.city,
        state: address.state,
        pincode: address.pincode,
        location: address.location,
        landmark: address.landmark || null,
      },
      scheduledDate: dto.scheduledDate,
      timeSlotId: slot._id.toString(),
      timeSlotSnapshot: {
        startTime: slot.startTime,
        endTime: slot.endTime,
        displayLabel: slot.displayLabel,
      },
      estimatedWeightRangeId: weightRange._id.toString(),
      estimatedWeightSnapshot: {
        name: weightRange.name,
        displayLabel: weightRange.displayLabel,
        minGrams: weightRange.minGrams,
        maxGrams: weightRange.maxGrams,
      },
      categories: dto.categoryIds,
      settlementPreference: dto.settlementPreference,
      status: PickupStatus.REQUESTED,
      preparation: {
        tools: dto.tools || [],
        remarks: dto.remarks || '',
      },
      timestamps: {
        requestedAt: new Date(),
      },
    });

    // Automatically transition to SCHEDULED since slot capacity is validated
    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.SCHEDULED,
      actor: { userId: customerId, role: 'SYSTEM', name: 'System Scheduler' },
      payload: { bookedSlot: slot.displayLabel },
    });
  }

  /**
   * Customer optionally adds remarks, tools, or photos post-booking.
   */
  async updatePreparation(
    pickupId: string,
    customerId: string,
    dto: UpdatePreparationDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (dto.tools) pickup.preparation.tools = dto.tools;
    if (dto.remarks) pickup.preparation.remarks = dto.remarks;
    if (dto.photoUrls && dto.photoUrls.length > 0) {
      const newPhotos = dto.photoUrls.map((url) => ({ fileUrl: url, uploadedAt: new Date() }));
      pickup.photos.push(...newPhotos);
    }

    await pickup.save();
    return pickup;
  }

  /**
   * Admin assigns an employee and vehicle to a scheduled pickup.
   * Enforces Rule 5.8: employee must be APPROVED and have no expired documents.
   */
  async assignPickup(
    pickupId: string,
    adminUserId: string,
    dto: AssignPickupDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    // Guard: Employee must exist and be APPROVED (Rule 5.8)
    const employee = await this.employeeProfileModel.findById(dto.employeeProfileId);
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }
    if (employee.status !== EmployeeStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot assign employee: status is ${employee.status}. Only APPROVED employees can be assigned.`,
      );
    }

    // Guard: Verify no required documents have expired
    const activeDocs = await this.employeeDocModel.find({
      employeeProfileId: dto.employeeProfileId,
      isCurrent: true,
      status: DocumentStatus.VERIFIED,
    });

    const now = new Date();
    const hasExpired = activeDocs.some((d) => d.expiresOn && d.expiresOn < now);
    if (hasExpired) {
      throw new BadRequestException('Cannot assign employee: one or more required documents have expired.');
    }

    pickup.assignment = {
      employeeProfileId: employee._id.toString(),
      employeeCode: employee.employeeCode,
      employeeName: employee.fullName,
      vehicleType: dto.vehicleType,
      vehicleNumber: dto.vehicleNumber,
      assignedAt: now,
      assignedBy: adminUserId,
    };

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.ASSIGNED,
      actor: { userId: adminUserId, role: UserRole.ADMIN, name: 'Operations Admin' },
      payload: {
        employeeCode: employee.employeeCode,
        employeeName: employee.fullName,
        vehicleNumber: dto.vehicleNumber,
      },
    });
  }

  /**
   * Employee starts traveling to the customer address.
   */
  async startJourney(pickupId: string, employeeUserId: string): Promise<PickupDocument> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.ON_THE_WAY,
      actor: {
        userId: employeeUserId,
        role: UserRole.EMPLOYEE,
        name: employee.fullName,
      },
      payload: { employeeProfileId: employee._id.toString() },
    });
  }

  /**
   * Employee arrives at customer address.
   */
  async markArrived(pickupId: string, employeeUserId: string): Promise<PickupDocument> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.ARRIVED,
      actor: {
        userId: employeeUserId,
        role: UserRole.EMPLOYEE,
        name: employee.fullName,
      },
      payload: { employeeProfileId: employee._id.toString() },
    });
  }

  /**
   * Cancels a pickup. Enforces cutoff: customer can only cancel before ON_THE_WAY.
   */
  async cancelPickup(
    pickupId: string,
    userId: string,
    role: string,
    dto: CancelPickupDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (role === UserRole.CUSTOMER && pickup.customerId.toString() !== userId) {
      throw new ForbiddenException('You can only cancel your own pickups');
    }

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.CANCELLED,
      actor: { userId, role },
      reason: dto.reason,
    });
  }

  /**
   * Marks a pickup as failed (e.g. customer unavailable, hazardous scrap).
   */
  async failPickup(
    pickupId: string,
    userId: string,
    role: string,
    dto: FailPickupDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.FAILED,
      actor: { userId, role },
      reason: dto.reason,
    });
  }

  /**
   * Fetches single pickup with object-level security.
   */
  async getPickupById(pickupId: string, user: CurrentUserPayload): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    // Object-level permission check
    if (user.roles.includes(UserRole.ADMIN)) {
      return pickup;
    }

    if (user.roles.includes(UserRole.CUSTOMER)) {
      if (pickup.customerId.toString() !== user.userId) {
        throw new ForbiddenException('Access denied: You do not own this pickup');
      }
      return pickup;
    }

    if (user.roles.includes(UserRole.EMPLOYEE)) {
      const employee = await this.employeeProfileModel.findOne({ userId: user.userId });
      if (!employee || pickup.assignment?.employeeProfileId.toString() !== employee._id.toString()) {
        throw new ForbiddenException('Access denied: This pickup is not assigned to you');
      }
      return pickup;
    }

    throw new ForbiddenException('Access denied');
  }

  // --- List Pickups ---

  async listCustomerPickups(customerId: string, status?: PickupStatus): Promise<PickupDocument[]> {
    const filter: Record<string, any> = { customerId };
    if (status) filter.status = status;
    return this.pickupModel.find(filter).sort({ createdAt: -1 });
  }

  async listEmployeePickups(employeeUserId: string, status?: PickupStatus): Promise<PickupDocument[]> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) return [];

    const filter: Record<string, any> = { 'assignment.employeeProfileId': employee._id.toString() };
    if (status) filter.status = status;
    return this.pickupModel.find(filter).sort({ scheduledDate: 1, createdAt: -1 });
  }

  async listAdminPickups(status?: PickupStatus, date?: string): Promise<PickupDocument[]> {
    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    if (date) filter.scheduledDate = date;
    return this.pickupModel.find(filter).sort({ scheduledDate: -1, createdAt: -1 });
  }
}
