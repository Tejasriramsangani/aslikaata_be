import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SettlementsService } from '../src/modules/settlements/settlements.service.js';
import { PickupStateMachineService } from '../src/modules/pickups/pickup-state-machine.service.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');
const MOBILE = '9876543210';
const CUSTOMER = OID(2);
const EMPLOYEE_USER = OID(9);

/** Tiny in-memory otpchallenges collection that understands the filters the service uses. */
function fakeOtpModel() {
  const rows: any[] = [];
  const matches = (row: any, filter: Record<string, any>) =>
    Object.entries(filter).every(([key, value]) => {
      if (key === 'expiresAt') return row.expiresAt > value.$gt;
      if (value === null) return row[key] == null;
      return String(row[key]) === String(value);
    });
  return {
    rows,
    findOne: vi.fn((filter: any) => ({
      sort: async () => [...rows].reverse().find((r) => matches(r, filter)) ?? null,
    })),
    create: vi.fn(async (doc: any) => {
      const row = { attempts: 0, consumedAt: null, createdAt: new Date(), save: vi.fn(async () => undefined), ...doc };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(async (filter: any, update: any) => {
      rows.filter((r) => matches(r, filter)).forEach((r) => Object.assign(r, update.$set));
    }),
  };
}

/** Real PickupStateMachineService (real transition rules); only the database is faked. */
function build(status: PickupStatus = PickupStatus.SUMMARY_READY, summaryHash = 'HASH-1') {
  const pickup: any = {
    _id: { toString: () => OID(1) },
    pickupCode: 'AK-TESTCODE',
    customerId: CUSTOMER,
    status,
    items: [],
    totals: { grossWeightGrams: 1000, wastageGrams: 0, netWeightGrams: 1000, totalAmount: 5000 },
    confirmation: { confirmedBy: null, method: 'IN_APP', summaryHash, confirmedAt: null },
    timestamps: {},
    save: vi.fn(async () => undefined),
  };
  const otpModel = fakeOtpModel();
  let settlement: any = null;
  const settlementModel: any = {
    findOne: vi.fn(async (f: any) => (f.idempotencyKey ? null : settlement)),
    create: vi.fn(async (doc: any) => {
      const list = Array.isArray(doc);
      settlement = { _id: OID(5), settledAt: new Date(), ...(list ? doc[0] : doc) };
      return list ? [settlement] : settlement;
    }),
  };
  const eventModel: any = { create: vi.fn(async () => ({})) };
  const outbox: any = { createEvent: vi.fn(async () => ({})) };
  const stateMachine = new PickupStateMachineService(eventModel, outbox);

  const service = new SettlementsService(
    settlementModel,
    {} as any,
    { create: vi.fn(async () => [{ invoiceNumber: 'INV-10001' }]) } as any,
    {
      findById: vi.fn(async () => pickup),
      findOne: vi.fn(async (f: any) => (String(f.customerId) === CUSTOMER ? pickup : null)),
    } as any,
    otpModel as any,
    { findById: vi.fn(async () => ({ mobile: MOBILE })) } as any,
    { findOne: vi.fn(async () => ({ _id: { toString: () => OID(3) }, fullName: 'Ramesh' })) } as any,
    stateMachine,
    { generateInvoiceNumber: vi.fn(async () => 'INV-10001') } as any,
    { runInTransaction: vi.fn(async (fn: any) => fn({ id: 'txn' })) } as any,
    {} as any,
    outbox,
    undefined,
  );
  return { service, pickup, otpModel, settlementModel, eventModel, outbox, getSettlement: () => settlement };
}

describe('The customer code confirms the weighing summary (no separate approve step)', () => {
  it('shows the code with the summary, as soon as it is ready', async () => {
    const { service } = build(PickupStatus.SUMMARY_READY);
    const { code } = await service.getClosingCode(OID(1), CUSTOMER);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('one code entry takes SUMMARY_READY all the way to COMPLETED, with the customer confirmation and payment recorded', async () => {
    const { service, pickup, eventModel, settlementModel, getSettlement } = build(PickupStatus.SUMMARY_READY);
    const { code } = await service.getClosingCode(OID(1), CUSTOMER);

    const { pickup: done } = await service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, {
      code,
      paymentType: 'UPI',
      upiReference: 'UTR123',
    } as any);

    expect(done.status).toBe(PickupStatus.COMPLETED);
    const steps = eventModel.create.mock.calls.map((c: any[]) => c[0][0]);
    expect(steps.map((s: any) => [s.fromStatus, s.toStatus])).toEqual([
      ['SUMMARY_READY', 'CUSTOMER_CONFIRMED'],
      ['CUSTOMER_CONFIRMED', 'SETTLED'],
      ['SETTLED', 'OTP_VERIFIED'],
      ['OTP_VERIFIED', 'INVOICED'],
      ['INVOICED', 'COMPLETED'],
    ]);
    // the customer's confirmation is the code, tied to the summary they saw
    expect(pickup.confirmation).toMatchObject({
      confirmedBy: CUSTOMER,
      method: 'COMPLETION_CODE',
      summaryHash: 'HASH-1',
    });
    expect(pickup.confirmation.confirmedAt).toBeInstanceOf(Date);
    // the payment is recorded with the type the employee chose
    expect(settlementModel.create).toHaveBeenCalledTimes(1);
    expect(getSettlement()).toMatchObject({ type: 'UPI', amount: 5000, upiReference: 'UTR123' });
  });

  it('defaults to a cash payment', async () => {
    const { service, getSettlement } = build(PickupStatus.SUMMARY_READY);
    const { code } = await service.getClosingCode(OID(1), CUSTOMER);
    await service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code } as any);
    expect(getSettlement().type).toBe('CASH');
  });

  it('a wrong code changes nothing: no confirmation, no payment', async () => {
    const { service, pickup, settlementModel, otpModel } = build(PickupStatus.SUMMARY_READY);
    const { code } = await service.getClosingCode(OID(1), CUSTOMER);
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(
      service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: wrong } as any),
    ).rejects.toThrow(/Incorrect completion code/);

    expect(pickup.status).toBe(PickupStatus.SUMMARY_READY);
    expect(settlementModel.create).not.toHaveBeenCalled();
    expect(otpModel.rows[0].attempts).toBe(1);
  });

  it('a code stops working if the amounts change after the customer saw them', async () => {
    const { service, pickup, otpModel } = build(PickupStatus.SUMMARY_READY, 'HASH-1');
    const { code: oldCode } = await service.getClosingCode(OID(1), CUSTOMER);

    // the picker re-weighs: new summary, new hash
    pickup.confirmation.summaryHash = 'HASH-2';

    await expect(
      service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: oldCode } as any),
    ).rejects.toThrow(/missing or has expired/);
    expect(pickup.status).toBe(PickupStatus.SUMMARY_READY);

    // the customer's app asks again and gets a fresh code for the new summary
    const fresh = await service.getClosingCode(OID(1), CUSTOMER);
    expect(otpModel.rows).toHaveLength(2);
    expect(otpModel.rows[1].summaryHash).toBe('HASH-2');
    const { pickup: done } = await service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: fresh.code } as any);
    expect(done.status).toBe(PickupStatus.COMPLETED);
  });

  it('still shows the same code while the summary is unchanged', async () => {
    const { service, otpModel } = build(PickupStatus.SUMMARY_READY);
    const first = await service.getClosingCode(OID(1), CUSTOMER);
    const second = await service.getClosingCode(OID(1), CUSTOMER);
    expect(second.code).toBe(first.code);
    expect(otpModel.rows).toHaveLength(1);
  });

  it('pickups already approved or paid under the older flow can still be completed', async () => {
    for (const status of [PickupStatus.CUSTOMER_CONFIRMED, PickupStatus.SETTLED]) {
      const { service, settlementModel } = build(status);
      // a SETTLED pickup already has its payment recorded
      if (status === PickupStatus.SETTLED) await settlementModel.create({ type: 'CASH', amount: 5000 });
      const { code } = await service.getClosingCode(OID(1), CUSTOMER);
      const { pickup } = await service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code } as any);
      expect(pickup.status).toBe(PickupStatus.COMPLETED);
    }
  });

  it('is not available before the summary exists', async () => {
    const { service } = build(PickupStatus.MEASURED);
    await expect(service.getClosingCode(OID(1), CUSTOMER)).rejects.toThrow(BadRequestException);
  });

  it('cannot be used for a different pickup\'s summary hash', async () => {
    const { service, otpModel } = build(PickupStatus.SUMMARY_READY);
    await otpModel.create({
      mobile: MOBILE,
      purpose: 'PICKUP_COMPLETION',
      pickupId: OID(1),
      summaryHash: 'SOMETHING-ELSE',
      codeHash: CryptoUtil.hashSha256('654321', MOBILE),
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60000),
    });
    await expect(
      service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: '654321' } as any),
    ).rejects.toThrow(/missing or has expired/);
  });
});
