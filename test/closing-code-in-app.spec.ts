import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SettlementsService } from '../src/modules/settlements/settlements.service.js';
import { PickupStateMachineService } from '../src/modules/pickups/pickup-state-machine.service.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');
const MOBILE = '9876543210';
const CUSTOMER = OID(2);
const EMPLOYEE_USER = OID(9);

/** Tiny in-memory stand-in for the otpchallenges collection. */
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

function build(status: PickupStatus = PickupStatus.CUSTOMER_CONFIRMED) {
  const pickup: any = {
    _id: { toString: () => OID(1) },
    pickupCode: 'AK-TESTCODE',
    customerId: CUSTOMER,
    status,
    items: [],
    totals: { grossWeightGrams: 1000, wastageGrams: 0, netWeightGrams: 1000, totalAmount: 5000 },
    timestamps: {},
    save: vi.fn(async () => undefined),
  };
  const otpModel = fakeOtpModel();
  let settlement: any = null;
  const settlementModel: any = {
    findOne: vi.fn(async (f: any) => (f.idempotencyKey ? null : settlement)),
    create: vi.fn(async (doc: any) => (settlement = { _id: OID(5), settledAt: new Date(), ...doc })),
  };
  const identityService = { sendOtp: vi.fn(async () => ({})) };
  const stateMachine = new PickupStateMachineService(
    { create: vi.fn(async () => ({})) } as any,
    { createEvent: vi.fn(async () => ({})) } as any,
  );

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
    identityService as any,
    { createEvent: vi.fn(async () => ({})) } as any,
    undefined,
  );
  return { service, pickup, otpModel, identityService };
}

describe('Completion code is shown in the customer app (no SMS)', () => {
  it('appears with the weighing summary, not before', async () => {
    for (const status of [PickupStatus.ASSIGNED, PickupStatus.IN_PROGRESS, PickupStatus.MEASURED]) {
      const { service } = build(status);
      await expect(service.getClosingCode(OID(1), CUSTOMER)).rejects.toThrow(BadRequestException);
    }
    for (const status of [PickupStatus.SUMMARY_READY, PickupStatus.CUSTOMER_CONFIRMED, PickupStatus.SETTLED]) {
      const { service } = build(status);
      await expect(service.getClosingCode(OID(1), CUSTOMER)).resolves.toMatchObject({ pickupCode: 'AK-TESTCODE' });
    }
  });

  it('is not available once the pickup is completed', async () => {
    const { service } = build(PickupStatus.COMPLETED);
    await expect(service.getClosingCode(OID(1), CUSTOMER)).rejects.toThrow(BadRequestException);
  });

  it('only the pickup owner can see it', async () => {
    const { service } = build();
    await expect(service.getClosingCode(OID(1), OID(77))).rejects.toThrow(NotFoundException);
  });

  it('issues a 6-digit code, keeps only a hash plus an encrypted copy, and never sends an SMS', async () => {
    const { service, otpModel, identityService } = build();
    const { code, expiresAt } = await service.getClosingCode(OID(1), CUSTOMER);

    expect(code).toMatch(/^\d{6}$/);
    const row = otpModel.rows[0];
    expect(row.channel).toBe('APP');
    expect(row.codeHash).toBe(CryptoUtil.hashSha256(code, MOBILE));
    expect(row.codeEnc).toBeTruthy();
    expect(row.codeEnc).not.toContain(code);
    expect(CryptoUtil.decryptAes256(row.codeEnc)).toBe(code);
    expect(String(row.pickupId)).toBe(OID(1));
    const minutes = (expiresAt.getTime() - Date.now()) / 60000;
    expect(minutes).toBeGreaterThan(25);
    expect(minutes).toBeLessThanOrEqual(30);
    expect(identityService.sendOtp).not.toHaveBeenCalled();
  });

  it('shows the same code again until it is used, instead of changing under the customer', async () => {
    const { service, otpModel } = build();
    const first = await service.getClosingCode(OID(1), CUSTOMER);
    const second = await service.getClosingCode(OID(1), CUSTOMER);
    expect(second.code).toBe(first.code);
    expect(otpModel.rows).toHaveLength(1);
  });

  it('refresh retires the old code and issues a new one', async () => {
    const { service, otpModel } = build();
    const first = await service.getClosingCode(OID(1), CUSTOMER);
    const fresh = await service.resendClosingOtp(OID(1), CUSTOMER);

    expect(otpModel.rows).toHaveLength(2);
    expect(otpModel.rows[0].consumedAt).toBeInstanceOf(Date);
    expect(otpModel.rows[1].consumedAt).toBeNull();
    expect(otpModel.rows[1].codeHash).toBe(CryptoUtil.hashSha256(fresh.code, MOBILE));
    expect((await service.getClosingCode(OID(1), CUSTOMER)).code).toBe(fresh.code);
    expect(first.code).toMatch(/^\d{6}$/);
  });

  it('after too many wrong attempts the customer gets a fresh code on request', async () => {
    const { service, otpModel } = build();
    await service.getClosingCode(OID(1), CUSTOMER);
    otpModel.rows[0].attempts = otpModel.rows[0].maxAttempts;
    const again = await service.getClosingCode(OID(1), CUSTOMER);
    expect(otpModel.rows).toHaveLength(2);
    expect(CryptoUtil.decryptAes256(otpModel.rows[1].codeEnc)).toBe(again.code);
  });
});

describe('Employee completes the pickup with the code the customer reads out', () => {
  it('customer approves -> sees code -> employee records payment -> enters code -> COMPLETED, with no SMS', async () => {
    const { service, pickup, identityService } = build(PickupStatus.CUSTOMER_CONFIRMED);

    const { code } = await service.getClosingCode(OID(1), CUSTOMER);
    await service.recordSettlement(OID(1), EMPLOYEE_USER, { type: 'CASH', idempotencyKey: 'k1' } as any);
    expect(pickup.status).toBe(PickupStatus.SETTLED);
    expect(identityService.sendOtp).not.toHaveBeenCalled();

    const done = await service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code } as any);
    expect(done.pickup.status).toBe(PickupStatus.COMPLETED);
  });

  it('a wrong code is refused and counted; the right code still works afterwards', async () => {
    const { service, pickup, otpModel } = build(PickupStatus.SETTLED);
    const { code } = await service.getClosingCode(OID(1), CUSTOMER);
    const wrong = code === '000000' ? '111111' : '000000';

    await expect(service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: wrong } as any)).rejects.toThrow(
      /Incorrect completion code/,
    );
    expect(otpModel.rows[0].attempts).toBe(1);
    expect(pickup.status).toBe(PickupStatus.SETTLED);

    // settlement is needed for completion: record it in the fake first
    (service as any).settlementModel.findOne = vi.fn(async () => ({ _id: OID(5), type: 'CASH', settledAt: new Date() }));
    const done = await service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code } as any);
    expect(done.pickup.status).toBe(PickupStatus.COMPLETED);
  });

  it('tells the employee to have the customer refresh after too many wrong attempts', async () => {
    const { service, otpModel } = build(PickupStatus.SETTLED);
    await service.getClosingCode(OID(1), CUSTOMER);
    otpModel.rows[0].attempts = otpModel.rows[0].maxAttempts;

    await expect(service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: '123456' } as any)).rejects.toThrow(
      /tap refresh/,
    );
  });

  it('a code issued for a different pickup does not work', async () => {
    const { service, otpModel } = build(PickupStatus.SETTLED);
    await otpModel.create({
      mobile: MOBILE,
      purpose: 'PICKUP_COMPLETION',
      pickupId: OID(99),
      codeHash: CryptoUtil.hashSha256('654321', MOBILE),
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60000),
    });
    await expect(service.verifyClosingOtpAndComplete(OID(1), EMPLOYEE_USER, { code: '654321' } as any)).rejects.toThrow(
      /missing or has expired/,
    );
  });
});
