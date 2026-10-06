import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Settlement, SettlementDocument, SettlementStatus, SettlementType } from './schemas/settlement.schema.js';
import { DonationRecipient, DonationRecipientDocument } from './schemas/donation-recipient.schema.js';
import { Invoice, InvoiceDocument, InvoiceType } from '../invoices/schemas/invoice.schema.js';
import { Pickup, PickupDocument } from '../pickups/schemas/pickup.schema.js';
import { PickupStatus } from '../pickups/schemas/pickup-status.enum.js';
import { OtpChallenge, OtpChallengeDocument, OtpPurpose } from '../identity/schemas/otp-challenge.schema.js';
import { User, UserDocument } from '../identity/schemas/user.schema.js';
import { EmployeeProfile, EmployeeProfileDocument } from '../employees/schemas/employee-profile.schema.js';
import { PickupStateMachineService } from '../pickups/pickup-state-machine.service.js';
import { SequenceService } from '../../common/database/sequence.service.js';
import { TransactionRunner } from '../../common/database/transaction-runner.js';
import { IdentityService } from '../identity/identity.service.js';
import { CryptoUtil } from '../../common/utils/crypto.util.js';
import { UserRole } from '../../common/decorators/roles.decorator.js';
import {
  RecordSettlementDto,
  VerifyClosingOtpDto,
  CreateDonationRecipientDto,
} from './dto/settlement.dto.js';
import type { CurrentUserPayload } from '../../common/decorators/current-user.decorator.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { DailyStatsService } from '../analytics/daily-stats.service.js';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(
    @InjectModel(Settlement.name)
    private readonly settlementModel: Model<SettlementDocument>,
    @InjectModel(DonationRecipient.name)
    private readonly donationRecipientModel: Model<DonationRecipientDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Pickup.name)
    private readonly pickupModel: Model<PickupDocument>,
    @InjectModel(OtpChallenge.name)
    private readonly otpModel: Model<OtpChallengeDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(EmployeeProfile.name)
    private readonly employeeProfileModel: Model<EmployeeProfileDocument>,
    private readonly stateMachine: PickupStateMachineService,
    private readonly sequenceService: SequenceService,
    private readonly transactionRunner: TransactionRunner,
    private readonly identityService: IdentityService,
    @Optional() private readonly outboxService?: OutboxService,
    @Optional() private readonly dailyStatsService?: DailyStatsService,
  ) {}

  /**
   * Flow Step 9: Settlement Recording.
   * Employee records the payment (Cash/UPI/Donate).
   * Guard: Payment is blocked until the customer has approved (status must be CUSTOMER_CONFIRMED).
   * Dispatches the Gate 3 closing OTP to the customer upon successful settlement.
   */
  async recordSettlement(
    pickupId: string,
    employeeUserId: string,
    dto: RecordSettlementDto,
  ): Promise<{ settlement: SettlementDocument; message: string }> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    // Guard: Payment is strictly blocked until the customer has approved
    if (pickup.status !== PickupStatus.CUSTOMER_CONFIRMED && pickup.status !== PickupStatus.PAYMENT_PENDING) {
      throw new BadRequestException(
        `Settlement is blocked. Pickup must be in CUSTOMER_CONFIRMED status, but is currently ${pickup.status}. Customer must approve the summary first.`,
      );
    }

    // Idempotency check: if settlement already recorded with this key, return it
    const existing = await this.settlementModel.findOne({ idempotencyKey: dto.idempotencyKey });
    if (existing) {
      return { settlement: existing, message: 'Settlement already recorded (idempotent)' };
    }

    // Validate donation recipient if donating
    let donationRecipient: DonationRecipientDocument | null = null;
    if (dto.type === SettlementType.DONATE) {
      if (!dto.donationRecipientId) {
        throw new BadRequestException('donationRecipientId is required when settlement type is DONATE');
      }
      donationRecipient = await this.donationRecipientModel.findById(dto.donationRecipientId);
      if (!donationRecipient || !donationRecipient.isActive) {
        throw new NotFoundException('Selected donation recipient not found or inactive');
      }
    }

    const settlementAmount = pickup.totals.totalAmount; // integer paise calculated by server

    const settlement = await this.settlementModel.create({
      pickupId: pickup._id.toString(),
      type: dto.type,
      amount: settlementAmount,
      status: SettlementStatus.COMPLETED,
      upiReference: dto.upiReference || null,
      idempotencyKey: dto.idempotencyKey,
      donationRecipientId: dto.donationRecipientId || null,
      receiptNumber: dto.type === SettlementType.DONATE ? `DON-${Date.now()}` : null,
      settledAt: new Date(),
    });

    // Transition pickup: CUSTOMER_CONFIRMED -> SETTLED
    await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.SETTLED,
      actor: {
        userId: employeeUserId,
        role: UserRole.EMPLOYEE,
        name: employee.fullName,
      },
      payload: {
        employeeProfileId: employee._id.toString(),
        settlementType: dto.type,
        amount: settlementAmount,
      },
    });

    // Gate 3: Automatically dispatch completion OTP to customer's registered number
    const customer = await this.userModel.findById(pickup.customerId);
    if (customer) {
      try {
        await this.identityService.sendOtp({
          mobile: customer.mobile,
          purpose: OtpPurpose.PICKUP_COMPLETION,
          pickupId: pickup._id.toString(),
        });
      } catch (err) {
        this.logger.warn(`Completion OTP cooldown or dispatch notice: ${err}`);
      }
    }

    const outbox = this.outboxService;
    if (outbox) {
      await outbox.createEvent('settlement.completed', {
        pickupId: pickup._id.toString(),
        pickupCode: pickup.pickupCode,
        customerId: pickup.customerId,
        amount: pickup.totals.totalAmount,
        type: dto.type,
      });
    }

    return {
      settlement,
      message: 'Settlement recorded successfully. Closing OTP dispatched to customer.',
    };
  }

  /**
   * Resends closing OTP to customer with cooldown enforcement.
   */
  async resendClosingOtp(pickupId: string, customerId: string) {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (pickup.status !== PickupStatus.SETTLED) {
      throw new BadRequestException(
        `Closing OTP can only be resent when pickup is in SETTLED status, but is currently ${pickup.status}`,
      );
    }

    const customer = await this.userModel.findById(customerId);
    if (!customer) {
      throw new NotFoundException('Customer user record not found');
    }

    return this.identityService.sendOtp({
      mobile: customer.mobile,
      purpose: OtpPurpose.PICKUP_COMPLETION,
      pickupId: pickup._id.toString(),
    });
  }

  /**
   * Flow Steps 10 & 11: Gate 3 - Closing OTP Verification & Atomic Completion.
   * Executes in ONE atomic MongoDB transaction:
   * 1. Verifies OTP & marks consumed
   * 2. Transitions: SETTLED -> OTP_VERIFIED -> INVOICED -> COMPLETED
   * 3. Generates sequential invoiceNumber (INV-XXXXX) & creates invoice / donation receipt
   */
  async verifyClosingOtpAndComplete(
    pickupId: string,
    employeeUserId: string,
    dto: VerifyClosingOtpDto,
  ): Promise<{ pickup: PickupDocument; invoice: InvoiceDocument }> {
    const employee = await this.employeeProfileModel.findOne({ userId: employeeUserId });
    if (!employee) {
      throw new NotFoundException('Employee profile not found');
    }

    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (pickup.status !== PickupStatus.SETTLED) {
      throw new BadRequestException(
        `Cannot verify closing OTP: pickup must be in SETTLED status, but is currently ${pickup.status}`,
      );
    }

    const customer = await this.userModel.findById(pickup.customerId);
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }

    const now = new Date();

    // Verify OTP Challenge
    const challenge = await this.otpModel
      .findOne({
        mobile: customer.mobile,
        purpose: OtpPurpose.PICKUP_COMPLETION,
        consumedAt: null,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 });

    if (!challenge) {
      throw new BadRequestException('Invalid or expired completion OTP. Please ask customer to request a new one.');
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new BadRequestException('Maximum verification attempts exceeded for closing OTP.');
    }

    const inputHash = CryptoUtil.hashSha256(dto.code, customer.mobile);
    if (challenge.codeHash !== inputHash) {
      challenge.attempts += 1;
      await challenge.save();
      const remaining = challenge.maxAttempts - challenge.attempts;
      throw new BadRequestException(`Incorrect closing OTP. ${remaining} attempts remaining.`);
    }

    // Look up settlement
    const settlement = await this.settlementModel.findOne({ pickupId: pickup._id.toString() });
    if (!settlement) {
      throw new BadRequestException('Settlement record missing for this pickup');
    }

    // Generate atomic sequence invoice number (INV-10001)
    const invoiceNumber = await this.sequenceService.generateInvoiceNumber();

    // Execute atomic Multi-Document MongoDB Transaction (Rule 5.6 & 9)
    const validPickup = pickup;
    const result = await this.transactionRunner.runInTransaction(async (session) => {
      // 1. Mark OTP challenge as consumed
      challenge.consumedAt = now;
      await challenge.save({ session });

      // 2. Determine invoice type (Rule 5.10: Donation becomes donation receipt)
      const invoiceType =
        settlement.type === SettlementType.DONATE
          ? InvoiceType.DONATION_RECEIPT
          : InvoiceType.CUSTOMER_TAX_INVOICE;

      // 3. Create invoice / donation receipt
      const [invoice] = await this.invoiceModel.create(
        [
          {
            pickupId: validPickup._id.toString(),
            invoiceNumber,
            type: invoiceType,
            lineItems: validPickup.items.map((i) => ({
              productId: i.productId,
              productName: i.productName,
              grossWeightGrams: i.grossWeightGrams,
              wastageGrams: i.wastageGrams,
              netWeightGrams: i.netWeightGrams,
              ratePerKgSnapshot: i.ratePerKgSnapshot,
              amount: i.amount,
            })),
            grossWeightGrams: validPickup.totals.grossWeightGrams,
            wastageGrams: validPickup.totals.wastageGrams,
            netWeightGrams: validPickup.totals.netWeightGrams,
            totalAmount: validPickup.totals.totalAmount,
            settlementDetails: {
              settlementId: settlement._id.toString(),
              type: settlement.type,
              upiReference: settlement.upiReference || null,
              settledAt: settlement.settledAt,
            },
            issuedAt: now,
          },
        ],
        { session },
      );

      // 4. Update timestamps and complete pickup in state machine
      validPickup.timestamps.otpVerifiedAt = now;
      validPickup.timestamps.invoicedAt = now;
      validPickup.timestamps.completedAt = now;

      await this.stateMachine.transition({
        pickup: validPickup,
        toStatus: PickupStatus.COMPLETED,
        actor: {
          userId: employeeUserId,
          role: UserRole.EMPLOYEE,
          name: employee.fullName,
        },
        payload: {
          employeeProfileId: employee._id.toString(),
          invoiceNumber,
          totalAmount: validPickup.totals.totalAmount,
        },
      });

      // 5. Update atomic pre-aggregated dailystats (Section 9 & 10)
      if (this.dailyStatsService) {
        await this.dailyStatsService.recordPickupCompletion(validPickup, settlement, session);
      }

      return { pickup: validPickup, invoice };
    });

    const outbox = this.outboxService;
    if (outbox) {
      await outbox.createEvent('otp.verified', {
        pickupId: validPickup._id.toString(),
        pickupCode: validPickup.pickupCode,
      });
      await outbox.createEvent('pickup.completed', {
        pickupId: validPickup._id.toString(),
        pickupCode: validPickup.pickupCode,
        customerId: validPickup.customerId,
        invoiceNumber: result.invoice.invoiceNumber,
        totalAmount: validPickup.totals.totalAmount,
      });
    }

    return result;
  }

  /**
   * Retrieves generated invoice for a completed pickup with object-level security.
   */
  async getInvoiceForPickup(pickupId: string, user: CurrentUserPayload): Promise<InvoiceDocument> {
    const pickup = await this.pickupModel.findById(pickupId);
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }

    if (user.roles.includes(UserRole.CUSTOMER) && pickup.customerId.toString() !== user.userId) {
      throw new ForbiddenException('Access denied: You do not own this pickup invoice');
    }

    const invoice = await this.invoiceModel.findOne({ pickupId });
    if (!invoice) {
      throw new NotFoundException('Invoice not found for this pickup. The transaction may not be completed yet.');
    }

    return invoice;
  }

  // --- Donation Recipients Management ---

  async listDonationRecipients(): Promise<DonationRecipientDocument[]> {
    return this.donationRecipientModel.find({ isActive: true }).sort({ displayOrder: 1, name: 1 });
  }

  async createDonationRecipient(dto: CreateDonationRecipientDto): Promise<DonationRecipientDocument> {
    return this.donationRecipientModel.create({
      name: dto.name,
      registrationNumber: dto.registrationNumber,
      causeDescription: dto.causeDescription || '',
      accountDetails: dto.accountDetails || {},
      isActive: true,
    });
  }
}
