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

/**
 * The customer sees the completion code from the moment the weighing summary is ready (right under the
 * summary) until the pickup is completed. Sharing the code is how they confirm the summary.
 */
const CLOSING_CODE_STATUSES: PickupStatus[] = [
  PickupStatus.SUMMARY_READY,
  PickupStatus.CUSTOMER_CONFIRMED,
  PickupStatus.PAYMENT_PENDING,
  PickupStatus.SETTLED,
];
/** Long enough to cover handing over the money; the customer can refresh for a new one any time. */
/** Statuses a completion code can finish: summary ready (the code confirms it) up to payment recorded. */
const COMPLETABLE_STATUSES: PickupStatus[] = [
  PickupStatus.SUMMARY_READY,
  PickupStatus.CUSTOMER_CONFIRMED,
  PickupStatus.PAYMENT_PENDING,
  PickupStatus.SETTLED,
];
const CLOSING_CODE_MINUTES = 30;
const CLOSING_CODE_MAX_ATTEMPTS = 5;

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
   * Records the payment and moves the pickup CUSTOMER_CONFIRMED / PAYMENT_PENDING -> SETTLED. Shared by the
   * explicit settlement call and by completion with the customer's code. Pass `session` to make it part
   * of a surrounding transaction.
   */
  private async applySettlement(
    pickup: PickupDocument,
    employee: EmployeeProfileDocument,
    employeeUserId: string,
    input: { type: SettlementType; idempotencyKey: string; upiReference?: string; donationRecipientId?: string },
    session?: any,
  ): Promise<SettlementDocument> {
    // Validate donation recipient if donating
    if (input.type === SettlementType.DONATE) {
      if (!input.donationRecipientId) {
        throw new BadRequestException('donationRecipientId is required when settlement type is DONATE');
      }
      const recipient = await this.donationRecipientModel.findById(input.donationRecipientId);
      if (!recipient || !recipient.isActive) {
        throw new NotFoundException('Selected donation recipient not found or inactive');
      }
    }

    const settlementAmount = pickup.totals.totalAmount; // integer paise calculated by server
    const doc = {
      pickupId: pickup._id.toString(),
      type: input.type,
      amount: settlementAmount,
      status: SettlementStatus.COMPLETED,
      upiReference: input.upiReference || null,
      idempotencyKey: input.idempotencyKey,
      donationRecipientId: input.donationRecipientId || null,
      receiptNumber: input.type === SettlementType.DONATE ? `DON-${Date.now()}` : null,
      settledAt: new Date(),
    };
    const settlement = session
      ? (await this.settlementModel.create([doc], { session }))[0]
      : await this.settlementModel.create(doc);

    // CUSTOMER_CONFIRMED -> SETTLED
    await this.stateMachine.transition({
      pickup,
      toStatus: PickupStatus.SETTLED,
      actor: { userId: employeeUserId, role: UserRole.EMPLOYEE, name: employee.fullName },
      payload: {
        employeeProfileId: employee._id.toString(),
        settlementType: input.type,
        amount: settlementAmount,
      },
      session,
    });
    return settlement;
  }

  /**
   * Flow Step 9: Settlement Recording.
   * Employee records the payment (Cash/UPI/Donate).
   * Guard: Payment is blocked until the customer has approved (status must be CUSTOMER_CONFIRMED).
   * The Gate 3 closing code is NOT texted: the customer reads it from their own app (getClosingCode).
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

    const settlement = await this.applySettlement(pickup, employee, employeeUserId, dto);

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
      message: 'Payment recorded. Ask the customer for the code shown in their app to complete the pickup.',
    };
  }

  /**
   * The completion code for a pickup, for the CUSTOMER to read out to the picker (shown in the app, like
   * the pickup QR, instead of an SMS). Available once the customer has approved the final amount.
   *
   * The same code is returned until it is used, expires or runs out of attempts; then a new one is issued.
   * `refresh` retires the current code and issues a new one on demand.
   */
  async getClosingCode(
    pickupId: string,
    customerId: string,
    opts: { refresh?: boolean } = {},
  ): Promise<{ code: string; expiresAt: Date; pickupCode: string }> {
    const pickup = await this.pickupModel.findOne({ _id: pickupId, customerId });
    if (!pickup) {
      throw new NotFoundException('Pickup not found');
    }
    if (!CLOSING_CODE_STATUSES.includes(pickup.status)) {
      throw new BadRequestException(
        'Your code appears with the weighing summary and stays until the pickup is completed.',
      );
    }

    const customer = await this.userModel.findById(customerId);
    if (!customer) {
      throw new NotFoundException('Customer user record not found');
    }

    const now = new Date();
    const scope = {
      mobile: customer.mobile,
      purpose: OtpPurpose.PICKUP_COMPLETION,
      pickupId: pickup._id.toString(),
      // The code belongs to the summary on screen: new amounts mean a new code.
      summaryHash: pickup.confirmation?.summaryHash ?? null,
    };

    const active = await this.otpModel
      .findOne({ ...scope, consumedAt: null, expiresAt: { $gt: now } })
      .sort({ createdAt: -1 });
    if (active && active.codeEnc && !opts.refresh && active.attempts < active.maxAttempts) {
      return {
        code: CryptoUtil.decryptAes256(active.codeEnc),
        expiresAt: active.expiresAt,
        pickupCode: pickup.pickupCode,
      };
    }

    // Retire whatever is still open for this pickup, then issue a fresh code.
    await this.otpModel.updateMany({ ...scope, consumedAt: null }, { $set: { consumedAt: now } });

    const code = CryptoUtil.generateOtp(6);
    const expiresAt = new Date(now.getTime() + CLOSING_CODE_MINUTES * 60 * 1000);
    await this.otpModel.create({
      ...scope,
      codeHash: CryptoUtil.hashSha256(code, customer.mobile),
      codeEnc: CryptoUtil.encryptAes256(code),
      channel: 'APP',
      attempts: 0,
      maxAttempts: CLOSING_CODE_MAX_ATTEMPTS,
      expiresAt,
      resendCooldownUntil: now,
    });
    return { code, expiresAt, pickupCode: pickup.pickupCode };
  }

  /** Customer asks for a brand-new code (the old one is retired). */
  async resendClosingOtp(pickupId: string, customerId: string) {
    return this.getClosingCode(pickupId, customerId, { refresh: true });
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

    // The customer's code is also their confirmation of the weighing summary, so completion works straight
    // from SUMMARY_READY (payment is recorded together with it), as well as after an earlier approval / payment.
    if (!COMPLETABLE_STATUSES.includes(pickup.status)) {
      throw new BadRequestException(
        `Cannot complete with a code: the weighing summary must be ready first, but the pickup is ${pickup.status}`,
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
        // A code only works for the pickup it was issued for, and for the summary it was issued with.
        pickupId: pickup._id.toString(),
        summaryHash: pickup.confirmation?.summaryHash ?? null,
        consumedAt: null,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 });

    if (!challenge) {
      throw new BadRequestException(
        'The completion code is missing or has expired (or the amounts changed after the customer saw them). Ask the customer to open their pickup and tap refresh for a new code.',
      );
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      throw new BadRequestException(
        'Too many wrong attempts. Ask the customer to tap refresh in their app for a new completion code.',
      );
    }

    const inputHash = CryptoUtil.hashSha256(dto.code, customer.mobile);
    if (challenge.codeHash !== inputHash) {
      challenge.attempts += 1;
      await challenge.save();
      const remaining = challenge.maxAttempts - challenge.attempts;
      throw new BadRequestException(`Incorrect completion code. ${remaining} attempts remaining.`);
    }

    // A payment recorded earlier (older flow); otherwise it is recorded inside the transaction below.
    let settlement: SettlementDocument | null = await this.settlementModel.findOne({ pickupId: pickup._id.toString() });
    let settlementIsNew = false;
    if (!settlement && pickup.status === PickupStatus.SETTLED) {
      throw new BadRequestException('Settlement record missing for this pickup');
    }

    // Execute atomic Multi-Document MongoDB Transaction (Rule 5.6 & 9).
    // On standalone MongoDB (dev), TransactionRunner falls back to running
    // without a session (session = null). Mongoose ignores { session: null }.
    const validPickup = pickup;
    const result = await this.transactionRunner.runInTransaction(async (session) => {
      // 0. Next invoice number (INV-10001...). Drawn inside the transaction so a failed completion
      //    does not burn a number and leave a gap in the sequence.
      const invoiceNumber = await this.sequenceService.generateInvoiceNumber(session ?? undefined);

      // 1. Mark OTP challenge as consumed
      challenge.consumedAt = now;
      await challenge.save(session ? { session } : undefined);

      // 1b. The code IS the customer's confirmation: record it, then the payment, in this same transaction.
      if (validPickup.status === PickupStatus.SUMMARY_READY) {
        const approvedAt = now;
        validPickup.confirmation = {
          confirmedBy: String(validPickup.customerId),
          method: 'COMPLETION_CODE',
          summaryHash: validPickup.confirmation?.summaryHash ?? null,
          confirmedAt: approvedAt,
        };
        await this.stateMachine.transition({
          pickup: validPickup,
          toStatus: PickupStatus.CUSTOMER_CONFIRMED,
          actor: { userId: String(validPickup.customerId), role: UserRole.CUSTOMER },
          payload: { summaryHash: validPickup.confirmation.summaryHash, approvedAt, via: 'COMPLETION_CODE' },
          session,
        });
      }
      if (!settlement) {
        settlement = await this.applySettlement(
          validPickup,
          employee,
          employeeUserId,
          {
            type: dto.paymentType === SettlementType.UPI ? SettlementType.UPI : SettlementType.CASH,
            idempotencyKey: `completion-${validPickup._id.toString()}`,
            upiReference: dto.upiReference,
          },
          session ?? undefined,
        );
        settlementIsNew = true;
      }
      const recorded = settlement;

      // 2. Determine invoice type (Rule 5.10: Donation becomes donation receipt)
      const invoiceType =
        recorded.type === SettlementType.DONATE
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
              settlementId: recorded._id.toString(),
              type: recorded.type,
              upiReference: recorded.upiReference || null,
              settledAt: recorded.settledAt,
            },
            issuedAt: now,
          },
        ],
        session ? { session } : {},
      );

      // 4. Complete the pickup. The state machine only allows one step at a time
      //    (SETTLED -> OTP_VERIFIED -> INVOICED -> COMPLETED), each stamping its own timestamp, so walk
      //    them in order. All three share this transaction: if anything later fails, none of them stick.
      const actor = { userId: employeeUserId, role: UserRole.EMPLOYEE, name: employee.fullName };
      const employeeProfileId = employee._id.toString();
      const steps: Array<[PickupStatus, Record<string, any>]> = [
        [PickupStatus.OTP_VERIFIED, { employeeProfileId }],
        [PickupStatus.INVOICED, { employeeProfileId, invoiceNumber }],
        [
          PickupStatus.COMPLETED,
          { employeeProfileId, invoiceNumber, totalAmount: validPickup.totals.totalAmount },
        ],
      ];
      for (const [toStatus, payload] of steps) {
        await this.stateMachine.transition({ pickup: validPickup, toStatus, actor, payload, session });
      }

      // 5. Update atomic pre-aggregated dailystats (Section 9 & 10)
      if (this.dailyStatsService) {
        await this.dailyStatsService.recordPickupCompletion(
          validPickup,
          recorded,
          session ?? undefined,
        );
      }

      return { pickup: validPickup, invoice };
    });

    const outbox = this.outboxService;
    if (outbox && settlementIsNew) {
      await outbox.createEvent('settlement.completed', {
        pickupId: validPickup._id.toString(),
        pickupCode: validPickup.pickupCode,
        customerId: validPickup.customerId,
        amount: validPickup.totals.totalAmount,
        type: settlement?.type,
      });
    }
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
