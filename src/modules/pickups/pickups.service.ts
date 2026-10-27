import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, isValidObjectId } from 'mongoose';

import { Pickup, PickupDocument, PickupItem } from './schemas/pickup.schema.js';
import { PickupStatus } from './schemas/pickup-status.enum.js';
import { PickupQrToken, PickupQrTokenDocument } from './schemas/pickup-qr-token.schema.js';
import { PickupStateMachineService } from './pickup-state-machine.service.js';
import {
  RequestPickupDto,
  UpdatePreparationDto,
  AssignPickupDto,
  CancelPickupDto,
  FailPickupDto,
  ReschedulePickupDto,
  UpdateCategoriesDto,
} from './dto/pickup.dto.js';
import {
  VerifyQrDto,
  RecordItemsDto,
  ApproveSummaryDto,
} from './dto/field-ops.dto.js';
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
import { CatalogService } from '../catalog/catalog.service.js';
import { CryptoUtil } from '../../common/utils/crypto.util.js';
import { WeightUtil } from '../../common/utils/weight.util.js';
import { CurrencyUtil } from '../../common/utils/currency.util.js';
import { OrderClassificationService } from '../routing/services/order-classification.service.js';
import { BulkAutoAssignService } from '../routing/services/bulk-auto-assign.service.js';
import { RouteRunsService } from '../routing/services/route-runs.service.js';
import { DivisionService } from '../routing/services/division.service.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { DailyStatsService } from '../analytics/daily-stats.service.js';

@Injectable()
export class PickupsService {
  private readonly logger = new Logger(PickupsService.name);

  constructor(
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(PickupQrToken.name)
    private readonly qrTokenModel: Model<PickupQrTokenDocument>,
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
    private readonly catalogService: CatalogService,
    private readonly stateMachine: PickupStateMachineService,
    private readonly sequenceService: SequenceService,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional() private readonly dailyStatsService?: DailyStatsService,
    @Optional() private readonly classificationService?: OrderClassificationService,
    @Optional() private readonly bulkAutoAssignService?: BulkAutoAssignService,
    @Optional() private readonly routeRunsService?: RouteRunsService,
    @Optional() private readonly divisionService?: DivisionService,
  ) {}

  // --- Phase 3 Methods: Booking, Assignment & Transit ---

  async requestPickup(customerId: string, dto: RequestPickupDto): Promise<PickupDocument> {
    // 0. Ensure catalog has default categories/slots/ranges if empty
    try {
      const activeCats = await this.catalogService.listCategories(true);
      if (activeCats.length === 0) {
        await this.catalogService.seedDefaultCatalog(customerId);
      }
    } catch {
      // Non-blocking fallback
    }

    // 1. Resolve Address (resilient to mock IDs or uninitialized address)
    let address = (dto.addressId && isValidObjectId(dto.addressId))
      ? await this.addressModel.findOne({ _id: dto.addressId, userId: customerId })
      : null;

    if (!address) {
      address = await this.addressModel.findOne({ userId: customerId });
    }

    if (!address) {
      address = await this.addressModel.create({
        userId: customerId,
        line1: 'Doorstep Pickup Location, Madhura Nagar',
        city: 'Vijayawada',
        state: 'Andhra Pradesh',
        pincode: '520011',
        location: { type: 'Point', coordinates: [80.648, 16.5062] },
        landmark: 'Near Main Gate',
        isDefault: true,
      });
    }

    // 2. Resolve TimeSlot
    let slot = (dto.timeSlotId && isValidObjectId(dto.timeSlotId))
      ? await this.slotModel.findById(dto.timeSlotId)
      : null;

    if (!slot || !slot.isActive) {
      slot = await this.slotModel.findOne({ isActive: true });
    }

    if (!slot) {
      slot = await this.slotModel.create({
        startTime: '09:00',
        endTime: '11:00',
        displayLabel: '9:00 AM – 11:00 AM',
        maxPickups: 20,
        displayOrder: 1,
        isActive: true,
      });
    }

    const bookedCount = await this.pickupModel.countDocuments({
      scheduledDate: dto.scheduledDate,
      timeSlotId: slot._id.toString(),
      status: { $nin: [PickupStatus.CANCELLED, PickupStatus.FAILED] },
    });

    if (bookedCount >= slot.maxPickups) {
      throw new BadRequestException('Selected time slot is fully booked for this date. Please choose another slot.');
    }

    // 3. Resolve WeightRange
    let weightRange = (dto.estimatedWeightRangeId && isValidObjectId(dto.estimatedWeightRangeId))
      ? await this.weightRangeModel.findById(dto.estimatedWeightRangeId)
      : null;

    if (!weightRange || !weightRange.isActive) {
      weightRange = await this.weightRangeModel.findOne({ isActive: true });
    }

    if (!weightRange) {
      weightRange = await this.weightRangeModel.create({
        name: '10 – 20 kg',
        displayLabel: '10 – 20 kg (A few bags)',
        minGrams: 10000,
        maxGrams: 20000,
        displayOrder: 2,
        isActive: true,
      });
    }

    // 4. Resolve Categories (sanitize to only valid ObjectIds)
    let categoryIds = (dto.categoryIds || []).filter((id) => isValidObjectId(id));
    if (categoryIds.length === 0) {
      const allActiveCats = await this.catalogService.listCategories(true);
      categoryIds = allActiveCats.map((c) => c._id.toString());
    }

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
      categories: categoryIds,
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

    // 1. Classification (Context Addendum 1)
    let orderMeta: {
      orderType: 'BULK' | 'WEEKLY';
      limitKgApplied: number;
      rangeMinKg: number;
      rangeMaxKg: number;
      decidedAt: Date;
    } = {
      orderType: 'BULK',
      limitKgApplied: 10,
      rangeMinKg: (weightRange.minGrams || 0) / 1000,
      rangeMaxKg: (weightRange.maxGrams || 0) / 1000,
      decidedAt: new Date(),
    };

    if (this.classificationService) {
      orderMeta = await this.classificationService.classify({
        minGrams: weightRange.minGrams,
        maxGrams: weightRange.maxGrams,
      });
    }

    pickup.orderMeta = orderMeta;
    // Manual dispatch for now (weekly auto-routing is a future upgrade).
    // Customer slot is stored; admin accepts + assigns any available employee.
    pickup.unassigned = true;
    pickup.needsAdminReview = true;
    await pickup.save();

    let resultPickup: PickupDocument = await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.SCHEDULED,
      actor: { userId: customerId, role: 'SYSTEM', name: 'System Scheduler' },
      payload: {
        bookedSlot: slot.displayLabel,
        scheduledDate: dto.scheduledDate,
        awaitAdminAssign: true,
        orderType: orderMeta.orderType,
      },
    });

    if (this.outboxService) {
      await this.outboxService.createEvent('pickup.requested', {
        pickupId: resultPickup._id.toString(),
        pickupCode: resultPickup.pickupCode,
        customerId: resultPickup.customerId,
        scheduledDate: resultPickup.scheduledDate,
        timeSlotId: resultPickup.timeSlotId,
        orderType: orderMeta.orderType,
        pincode: resultPickup.addressSnapshot?.pincode,
      });
    }

    return resultPickup;
  }

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

  async reschedulePickup(
    pickupId: string,
    customerId: string,
    dto: ReschedulePickupDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }
    return this.applyReschedule(pickup, dto, 'CUSTOMER');
  }

  /** Admin can move a pending order to another date/slot when no employee is free. */
  async adminReschedulePickup(
    pickupId: string,
    adminUserId: string,
    dto: ReschedulePickupDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }
    return this.applyReschedule(pickup, dto, 'ADMIN', adminUserId);
  }

  private async applyReschedule(
    pickup: PickupDocument,
    dto: ReschedulePickupDto,
    actor: 'CUSTOMER' | 'ADMIN',
    adminUserId?: string,
  ): Promise<PickupDocument> {
    const lockedStatuses = [
      PickupStatus.ON_THE_WAY,
      PickupStatus.ARRIVED,
      PickupStatus.VERIFIED,
      PickupStatus.IN_PROGRESS,
      PickupStatus.CUSTOMER_CONFIRMED,
      PickupStatus.SETTLED,
      PickupStatus.COMPLETED,
      PickupStatus.CANCELLED,
      PickupStatus.FAILED,
    ];
    if (lockedStatuses.includes(pickup.status)) {
      throw new BadRequestException(`Cannot reschedule pickup in ${pickup.status} status`);
    }

    pickup.scheduledDate = dto.scheduledDate;

    if (dto.timeSlotId) {
      const slot = isValidObjectId(dto.timeSlotId)
        ? await this.slotModel.findById(dto.timeSlotId)
        : await this.slotModel.findOne({ isActive: true });
      if (slot && slot.isActive) {
        pickup.timeSlotId = slot._id.toString();
        pickup.timeSlotSnapshot = {
          startTime: slot.startTime,
          endTime: slot.endTime,
          displayLabel: slot.displayLabel,
        };
      }
    }

    // Keep in queue for later assign after admin moves the slot
    if (
      pickup.status === PickupStatus.REQUESTED ||
      pickup.status === PickupStatus.SCHEDULED
    ) {
      pickup.unassigned = true;
      pickup.needsAdminReview = true;
    }

    if (!pickup.timestamps.scheduledAt) {
      pickup.timestamps.scheduledAt = new Date();
    }

    await pickup.save();

    if (this.outboxService) {
      await this.outboxService.createEvent('pickup.status_changed', {
        pickupId: pickup._id.toString(),
        pickupCode: pickup.pickupCode,
        customerId: pickup.customerId.toString(),
        status: pickup.status,
        scheduledDate: pickup.scheduledDate,
        timeSlot: pickup.timeSlotSnapshot?.displayLabel,
        action: 'RESCHEDULED',
        actor,
        adminUserId,
        reason: dto.reason || '',
      });
    }

    return pickup;
  }

  async updateCategories(
    pickupId: string,
    customerId: string,
    dto: UpdateCategoriesDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    const lockedStatuses = [
      PickupStatus.VERIFIED,
      PickupStatus.IN_PROGRESS,
      PickupStatus.CUSTOMER_CONFIRMED,
      PickupStatus.SETTLED,
      PickupStatus.COMPLETED,
      PickupStatus.CANCELLED,
      PickupStatus.FAILED,
    ];
    if (lockedStatuses.includes(pickup.status)) {
      throw new BadRequestException(`Cannot modify categories in ${pickup.status} status`);
    }

    const validCategoryIds = (dto.categoryIds || []).filter((id) => isValidObjectId(id));
    if (validCategoryIds.length > 0) {
      pickup.categories = validCategoryIds;
    }
    await pickup.save();
    return pickup;
  }

  async assignPickup(
    pickupId: string,
    adminUserId: string,
    dto: AssignPickupDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    const employee = await this.employeeProfileModel.findById(dto.employeeProfileId);
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }
    if (employee.status !== EmployeeStatus.APPROVED) {
      throw new BadRequestException(
        `Cannot assign employee: status is ${employee.status}. Only APPROVED employees can be assigned.`,
      );
    }

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
      method: 'ADMIN',
    };
    pickup.unassigned = false;

    const assignedPickup = await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.ASSIGNED,
      actor: { userId: adminUserId, role: UserRole.ADMIN, name: 'Operations Admin' },
      payload: {
        employeeCode: employee.employeeCode,
        employeeName: employee.fullName,
        vehicleNumber: dto.vehicleNumber,
      },
    });

    if (this.outboxService) {
      await this.outboxService.createEvent('pickup.assigned', {
        pickupId: assignedPickup._id.toString(),
        pickupCode: assignedPickup.pickupCode,
        customerId: assignedPickup.customerId,
        employeeUserId: employee.userId,
        employeeProfileId: employee._id.toString(),
      });
    }

    return assignedPickup;
  }

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

  // --- Phase 4 Methods: Field Ops, QR Gate, Measurement & Customer Approval ---

  /**
   * Gate 1 - Dynamic QR Token Generation:
   * Customer generates QR token in their app to present to employee upon arrival.
   */
  async generateQrToken(
    pickupId: string,
    customerId: string,
  ): Promise<{ qrToken: string; expiresAt: Date; pickupCode: string }> {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    const validStatuses = [PickupStatus.ASSIGNED, PickupStatus.ON_THE_WAY, PickupStatus.ARRIVED];
    if (!validStatuses.includes(pickup.status)) {
      throw new BadRequestException(
        `QR token cannot be generated for pickup with status ${pickup.status}. Employee must be assigned or en route.`,
      );
    }

    const rawToken = `AK-QR-${CryptoUtil.generateRandomToken(20)}-${Date.now()}`;
    const tokenHash = CryptoUtil.hashSha256(rawToken, pickup._id.toString());
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes validity

    // Invalidate prior unused tokens for this pickup
    await this.qrTokenModel.updateMany(
      { pickupId, usedAt: null },
      { usedAt: new Date(0) }, // Expire / consume
    );

    await this.qrTokenModel.create({
      pickupId,
      tokenHash,
      expiresAt,
    });

    return {
      qrToken: rawToken,
      expiresAt,
      pickupCode: pickup.pickupCode,
    };
  }

  /**
   * Gate 1 - Dynamic QR Verification:
   * Employee scans the customer's QR. Proves correct job at physical location.
   * Transitions pickup from ARRIVED to VERIFIED.
   */
  async verifyQrToken(
    pickupId: string,
    employeeUserId: string,
    dto: VerifyQrDto,
  ): Promise<PickupDocument> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (pickup.status !== PickupStatus.ARRIVED) {
      throw new BadRequestException(
        `Cannot verify QR token: pickup must be in ARRIVED status, but is currently ${pickup.status}`,
      );
    }

    const tokenHash = CryptoUtil.hashSha256(dto.qrToken, pickup._id.toString());
    const now = new Date();

    const validToken = await this.qrTokenModel.findOne({
      pickupId: pickup._id.toString(),
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: now },
    });

    if (!validToken) {
      throw new BadRequestException('Invalid, expired, or already used QR token');
    }

    // Mark token as consumed
    validToken.usedAt = now;
    await validToken.save();

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.VERIFIED,
      actor: {
        userId: employeeUserId,
        role: UserRole.EMPLOYEE,
        name: employee.fullName,
      },
      payload: { employeeProfileId: employee._id.toString(), verifiedTokenId: validToken._id.toString() },
    });
  }

  /**
   * Flow Step 5: Explicit Start.
   * Employee starts the collection job after QR verification.
   * Transitions pickup from VERIFIED to IN_PROGRESS.
   */
  async startPickup(pickupId: string, employeeUserId: string): Promise<PickupDocument> {
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
      toStatus: PickupStatus.IN_PROGRESS,
      actor: {
        userId: employeeUserId,
        role: UserRole.EMPLOYEE,
        name: employee.fullName,
      },
      payload: { employeeProfileId: employee._id.toString() },
    });
  }

  /**
   * Scale Measurement & Calculation Engine:
   * Employee records gross weights and wastage for each product found.
   * Server validates Rule 5.2 (wastage < gross), fetches immutable rate snapshots (Rule 5.4),
   * calculates line and total amounts in integer paise (Rule 5.3), computes summaryHash,
   * locks items and transitions pickup to SUMMARY_READY.
   */
  async recordItems(
    pickupId: string,
    employeeUserId: string,
    dto: RecordItemsDto,
  ): Promise<PickupDocument> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    const allowedEntryStatuses = [
      PickupStatus.IN_PROGRESS,
      PickupStatus.MEASURED,
      PickupStatus.SUMMARY_READY,
      PickupStatus.CUSTOMER_CONFIRMED,
    ];

    if (!allowedEntryStatuses.includes(pickup.status)) {
      throw new BadRequestException(
        `Cannot record measurements when pickup is in ${pickup.status} status. Pickup must be started first.`,
      );
    }

    const processedItems: PickupItem[] = [];
    let grossTotal = 0;
    let wastageTotal = 0;
    let netTotal = 0;
    let grandAmountTotal = 0;

    for (const itemInput of dto.items) {
      // Rule 5.2: netWeightGrams = grossWeightGrams - wastageGrams (wastage >= 0 and strictly < gross)
      const netWeightGrams = WeightUtil.calculateNetWeight(
        itemInput.grossWeightGrams,
        itemInput.wastageGrams || 0,
      );

      // Fetch active rate snapshot for this product (Rule 5.4)
      const activeRate = await this.catalogService.getActiveRateForProduct(itemInput.productId);
      const product = await this.catalogService.listProducts();
      const matchedProduct = product.find((p) => p._id.toString() === itemInput.productId);

      if (!matchedProduct) {
        throw new NotFoundException(`Product ${itemInput.productId} not found in catalog`);
      }

      // Rule 5.3: amount = netWeightGrams * ratePerKg (in integer paise)
      const amountPaise = CurrencyUtil.calculateAmount(netWeightGrams, activeRate.ratePerKg);

      processedItems.push({
        productId: matchedProduct._id.toString(),
        productName: matchedProduct.name,
        categoryId: matchedProduct.categoryId.toString(),
        grossWeightGrams: itemInput.grossWeightGrams,
        wastageGrams: itemInput.wastageGrams || 0,
        netWeightGrams,
        wastageReason: itemInput.wastageReason || null,
        rateId: activeRate._id.toString(),
        ratePerKgSnapshot: activeRate.ratePerKg,
        amount: amountPaise,
      });

      grossTotal += itemInput.grossWeightGrams;
      wastageTotal += (itemInput.wastageGrams || 0);
      netTotal += netWeightGrams;
      grandAmountTotal += amountPaise;
    }

    // Save locked items & totals
    pickup.items = processedItems;
    pickup.totals = {
      grossWeightGrams: grossTotal,
      wastageGrams: wastageTotal,
      netWeightGrams: netTotal,
      totalAmount: grandAmountTotal,
    };

    // Generate cryptographic summary hash
    const summaryPayload = {
      pickupCode: pickup.pickupCode,
      itemCount: processedItems.length,
      netWeightGrams: netTotal,
      totalAmountPaise: grandAmountTotal,
      items: processedItems.map((i) => ({
        p: i.productId,
        net: i.netWeightGrams,
        rate: i.ratePerKgSnapshot,
        amt: i.amount,
      })),
    };

    const summaryHash = CryptoUtil.hashSha256(JSON.stringify(summaryPayload), pickup.pickupCode);

    // If re-measuring, previous customer confirmation is invalidated (Rule 4.8)
    pickup.confirmation = {
      confirmedBy: null,
      method: 'IN_APP',
      summaryHash,
      confirmedAt: null,
    };

    // Transition: IN_PROGRESS -> MEASURED -> SUMMARY_READY
    if (pickup.status === PickupStatus.IN_PROGRESS) {
      await this.stateMachine.transition({
        pickup,
        toStatus: PickupStatus.MEASURED,
        actor: { userId: employeeUserId, role: UserRole.EMPLOYEE, name: employee.fullName },
        payload: { employeeProfileId: employee._id.toString(), grossTotal, netTotal },
      });
    }

    const summaryReadyPickup = await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.SUMMARY_READY,
      actor: { userId: null, role: 'SYSTEM', name: 'Measurement Calculator' },
      payload: { summaryHash, totalAmount: grandAmountTotal },
    });

    if (this.outboxService) {
      await this.outboxService.createEvent('summary.ready', {
        pickupId: summaryReadyPickup._id.toString(),
        pickupCode: summaryReadyPickup.pickupCode,
        customerId: summaryReadyPickup.customerId,
        grossWeightGrams: summaryReadyPickup.totals.grossWeightGrams,
        wastageGrams: summaryReadyPickup.totals.wastageGrams,
        netWeightGrams: summaryReadyPickup.totals.netWeightGrams,
        totalAmount: summaryReadyPickup.totals.totalAmount,
        summaryHash,
      });
    }

    return summaryReadyPickup;
  }

  /**
   * Customer fetches itemized summary to review on their own device.
   */
  async getSummary(pickupId: string, customerId: string) {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    return {
      pickupCode: pickup.pickupCode,
      status: pickup.status,
      summaryHash: pickup.confirmation?.summaryHash || null,
      isApproved: !!pickup.confirmation?.confirmedAt,
      items: pickup.items.map((item) => ({
        productName: item.productName,
        grossWeightGrams: item.grossWeightGrams,
        grossWeightKg: WeightUtil.toKgString(item.grossWeightGrams),
        wastageGrams: item.wastageGrams,
        wastageKg: WeightUtil.toKgString(item.wastageGrams),
        netWeightGrams: item.netWeightGrams,
        netWeightKg: WeightUtil.toKgString(item.netWeightGrams),
        wastageReason: item.wastageReason,
        ratePerKgPaise: item.ratePerKgSnapshot,
        ratePerKgRupees: CurrencyUtil.toRupeesString(item.ratePerKgSnapshot),
        amountPaise: item.amount,
        amountRupees: CurrencyUtil.toRupeesString(item.amount),
      })),
      totals: {
        grossWeightGrams: pickup.totals.grossWeightGrams,
        grossWeightKg: WeightUtil.toKgString(pickup.totals.grossWeightGrams),
        wastageGrams: pickup.totals.wastageGrams,
        wastageKg: WeightUtil.toKgString(pickup.totals.wastageGrams),
        netWeightGrams: pickup.totals.netWeightGrams,
        netWeightKg: WeightUtil.toKgString(pickup.totals.netWeightGrams),
        totalAmountPaise: pickup.totals.totalAmount,
        totalAmountRupees: CurrencyUtil.toRupeesString(pickup.totals.totalAmount),
      },
    };
  }

  /**
   * Gate 2 - In-App Customer Approval:
   * Customer approves the itemized gross/wastage/net weights, rates, and grand total in-app.
   * Validates summaryHash match and transitions pickup from SUMMARY_READY to CUSTOMER_CONFIRMED.
   */
  async approveSummary(
    pickupId: string,
    customerId: string,
    dto: ApproveSummaryDto,
  ): Promise<PickupDocument> {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (pickup.status !== PickupStatus.SUMMARY_READY) {
      throw new BadRequestException(
        `Cannot approve pickup: status must be SUMMARY_READY, but is currently ${pickup.status}`,
      );
    }

    if (!pickup.confirmation?.summaryHash || pickup.confirmation.summaryHash !== dto.summaryHash) {
      throw new BadRequestException(
        'Summary hash mismatch. The measurement items may have changed. Please refresh and review again.',
      );
    }

    const now = new Date();
    pickup.confirmation = {
      confirmedBy: customerId,
      method: 'IN_APP',
      summaryHash: dto.summaryHash,
      confirmedAt: now,
    };

    return this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.CUSTOMER_CONFIRMED,
      actor: { userId: customerId, role: UserRole.CUSTOMER },
      payload: { summaryHash: dto.summaryHash, approvedAt: now },
    });
  }

  // --- Cancellation & Failure Handlers ---

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

    const cancelled = await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.CANCELLED,
      actor: { userId, role },
      reason: dto.reason,
    });

    if (this.dailyStatsService) {
      await this.dailyStatsService.recordPickupCancellation(new Date());
    }

    return cancelled;
  }

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

    const failed = await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.FAILED,
      actor: { userId, role },
      reason: dto.reason,
    });

    if (this.dailyStatsService) {
      await this.dailyStatsService.recordPickupFailure(new Date());
    }

    return failed;
  }

  // --- Query Methods with Object-Level Security ---

  async getPickupById(pickupId: string, user: CurrentUserPayload): Promise<PickupDocument> {
    const query = isValidObjectId(pickupId)
      ? this.pickupModel.findById(pickupId)
      : this.pickupModel.findOne({ pickupCode: pickupId });
    const pickup = typeof query?.populate === 'function' ? await query.populate('categories') : await query;
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

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

  async listCustomerPickups(customerId: string, status?: PickupStatus): Promise<PickupDocument[]> {
    const filter: Record<string, any> = { customerId };
    if (status) filter.status = status;
    const query = this.pickupModel.find(filter).sort({ createdAt: -1 });
    return typeof query?.populate === 'function' ? await query.populate('categories') : await query;
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
