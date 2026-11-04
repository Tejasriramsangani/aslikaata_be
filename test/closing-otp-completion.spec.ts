import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SettlementsService } from '../src/modules/settlements/settlements.service.js';
import { PickupStateMachineService } from '../src/modules/pickups/pickup-state-machine.service.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { UserRole } from '../src/common/decorators/roles.decorator.js';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');
const MOBILE = '9876543210';
const CODE = '482913';

/** Real PickupStateMachineService (real transition rules); only the database is faked. */
function build(overrides: { status?: PickupStatus; code?: string } = {}) {
  const session = { id: 'txn-1' };
  const pickup: any = {
    _id: { toString: () => OID(1) },
    pickupCode: 'AK-TESTCODE',
    customerId: OID(2),
    status: overrides.status ?? PickupStatus.SETTLED,
    items: [],
    totals: { grossWeightGrams: 1000, wastageGrams: 0, netWeightGrams: 1000, totalAmount: 5000 },
    timestamps: {},
    save: vi.fn(async () => undefined),
  };
  const challenge: any = {
    codeHash: CryptoUtil.hashSha256(overrides.code ?? CODE, MOBILE),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    save: vi.fn(async () => undefined),
  };

  const eventModel: any = { create: vi.fn(async () => ({})) };
  const outbox: any = { createEvent: vi.fn(async () => ({})) };
  const stateMachine = new PickupStateMachineService(eventModel, outbox);

  const service = new SettlementsService(
    { findOne: vi.fn(async () => ({ _id: OID(5), type: 'CASH', settledAt: new Date() })) } as any,
    {} as any,
    { create: vi.fn(async () => [{ invoiceNumber: 'INV-10001' }]) } as any,
    { findById: vi.fn(async () => pickup) } as any,
    { findOne: vi.fn(() => ({ sort: vi.fn(async () => challenge) })) } as any,
    { findById: vi.fn(async () => ({ mobile: MOBILE })) } as any,
    { findOne: vi.fn(async () => ({ _id: { toString: () => OID(3) }, fullName: 'Ramesh' })) } as any,
    stateMachine,
    { generateInvoiceNumber: vi.fn(async () => 'INV-10001') } as any,
    { runInTransaction: vi.fn(async (fn: any) => fn(session)) } as any,
    {} as any,
    outbox,
    undefined,
  );
  return { service, pickup, challenge, eventModel, outbox, session };
}

describe('Closing OTP completes a pickup through the real state machine', () => {
  it('walks SETTLED -> OTP_VERIFIED -> INVOICED -> COMPLETED instead of jumping', async () => {
    const { service, pickup, eventModel } = build();

    const { pickup: done, invoice } = await service.verifyClosingOtpAndComplete(OID(1), OID(9), { code: CODE } as any);

    expect(done.status).toBe(PickupStatus.COMPLETED);
    expect(invoice.invoiceNumber).toBe('INV-10001');
    const steps = eventModel.create.mock.calls.map((c: any[]) => c[0][0]);
    expect(steps.map((s: any) => [s.fromStatus, s.toStatus])).toEqual([
      ['SETTLED', 'OTP_VERIFIED'],
      ['OTP_VERIFIED', 'INVOICED'],
      ['INVOICED', 'COMPLETED'],
    ]);
    expect(pickup.timestamps.otpVerifiedAt).toBeInstanceOf(Date);
    expect(pickup.timestamps.invoicedAt).toBeInstanceOf(Date);
    expect(pickup.timestamps.completedAt).toBeInstanceOf(Date);
  });

  it('keeps every step in the same database transaction', async () => {
    const { service, pickup, eventModel, outbox, session } = build();
    await service.verifyClosingOtpAndComplete(OID(1), OID(9), { code: CODE } as any);

    expect(pickup.save).toHaveBeenCalledTimes(3);
    for (const call of pickup.save.mock.calls) expect(call[0]).toEqual({ session });
    for (const call of eventModel.create.mock.calls) expect(call[1]).toEqual({ session });
    const statusEvents = outbox.createEvent.mock.calls.filter((c: any[]) => c[0] === 'pickup.status_changed');
    expect(statusEvents).toHaveLength(3);
    for (const call of statusEvents) expect(call[2]).toBe(session);
  });

  it('consumes the OTP and then announces the completion', async () => {
    const { service, challenge, outbox } = build();
    await service.verifyClosingOtpAndComplete(OID(1), OID(9), { code: CODE } as any);

    expect(challenge.consumedAt).toBeInstanceOf(Date);
    const types = outbox.createEvent.mock.calls.map((c: any[]) => c[0]);
    expect(types).toContain('otp.verified');
    expect(types).toContain('pickup.completed');
  });

  it('a wrong OTP changes nothing', async () => {
    const { service, pickup, eventModel } = build({ code: '000000' });
    await expect(service.verifyClosingOtpAndComplete(OID(1), OID(9), { code: CODE } as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(pickup.status).toBe(PickupStatus.SETTLED);
    expect(eventModel.create).not.toHaveBeenCalled();
  });

  it('does not work before the weighing summary is ready', async () => {
    const { service } = build({ status: PickupStatus.MEASURED });
    await expect(service.verifyClosingOtpAndComplete(OID(1), OID(9), { code: CODE } as any)).rejects.toThrow(
      /weighing summary must be ready first/,
    );
  });

  it('documents the rule that caused the bug: a direct SETTLED -> COMPLETED jump is rejected', () => {
    const machine = new PickupStateMachineService({} as any);
    expect(() =>
      machine.validateTransition({
        pickup: { status: PickupStatus.SETTLED } as any,
        toStatus: PickupStatus.COMPLETED,
        actor: { role: UserRole.EMPLOYEE },
      }),
    ).toThrow(/Cannot move pickup from SETTLED to COMPLETED/);
  });
});
