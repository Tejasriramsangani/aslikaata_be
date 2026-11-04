import { describe, it, expect, vi } from 'vitest';
import { SequenceService } from '../src/common/database/sequence.service.js';
import { EmployeesService } from '../src/modules/employees/employees.service.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { validateEnv } from '../src/common/config/validate-env.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');

describe('Unique (non-counter) IDs', () => {
  const seq = new SequenceService({} as any);

  it('pickup IDs are random AK-XXXXXXXX codes without look-alike characters', async () => {
    const codes = await Promise.all(Array.from({ length: 200 }, () => seq.generatePickupCode()));
    for (const c of codes) expect(c).toMatch(/^AK-[2-9A-HJ-NP-Z]{8}$/);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('employee IDs are random EMP-XXXXXX codes', async () => {
    expect(await seq.generateEmployeeCode()).toMatch(/^EMP-[2-9A-HJ-NP-Z]{6}$/);
  });

  it('is not a counter: consecutive codes are not consecutive numbers', async () => {
    const [a, b] = [await seq.generatePickupCode(), await seq.generatePickupCode()];
    expect(a).not.toBe(b);
    expect(a).not.toMatch(/^AK-\d+$/);
  });

  it('draws again when a code is already used, and gives up after repeated collisions', async () => {
    const taken = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const code = await seq.generatePickupCode(taken);
    expect(taken).toHaveBeenCalledTimes(2);
    expect(code).toMatch(/^AK-/);

    await expect(seq.generateEmployeeCode(async () => true)).rejects.toThrow(/unique EMP code/);
  });

  it('invoice numbers stay sequential for accounting', async () => {
    const counter: any = { findByIdAndUpdate: vi.fn(async () => ({ seq: 7 })) };
    expect(await new SequenceService(counter).generateInvoiceNumber()).toBe('INV-10007');
  });
});

describe('Employees: availability + profile come from the database', () => {
  const profileDoc = (n: number, extra: any = {}) => ({
    _id: OID(100 + n),
    userId: OID(n),
    employeeCode: `EMP-${n}`,
    fullName: `Picker ${n}`,
    toObject() {
      return { _id: this._id, userId: this.userId, employeeCode: this.employeeCode, fullName: this.fullName, ...extra };
    },
  });

  const build = (opts: { profiles: any[]; users?: any[]; loggedIn?: string[]; pickups?: any[] }) => {
    const profileModel: any = {
      find: vi.fn(() => ({ sort: vi.fn(async () => opts.profiles) })),
      findOne: vi.fn(async () => opts.profiles[0]),
    };
    const userModel: any = {
      find: vi.fn(() => ({ select: vi.fn(async () => opts.users ?? []) })),
      findById: vi.fn(() => ({ select: vi.fn(async () => (opts.users ?? [])[0]) })),
    };
    const sessionModel: any = { distinct: vi.fn(async () => opts.loggedIn ?? []) };
    const pickupModel: any = {
      find: vi.fn(() => ({ select: vi.fn(() => ({ lean: vi.fn(async () => opts.pickups ?? []) })) })),
    };
    const service = new EmployeesService(
      profileModel,
      {} as any,
      userModel,
      {} as any,
      new SequenceService({} as any),
      undefined,
      pickupModel,
      sessionModel,
    );
    return { service, sessionModel, pickupModel };
  };

  it('marks only employees with an active session as logged in, and counts their open jobs', async () => {
    const { service } = build({
      profiles: [profileDoc(1), profileDoc(2), profileDoc(3)],
      users: [
        { _id: OID(1), mobile: '9000000001', lastLoginAt: new Date('2026-11-04') },
        { _id: OID(2), mobile: '9000000002' },
        { _id: OID(3), mobile: '9000000003' },
      ],
      loggedIn: [OID(1), OID(3)],
      pickups: [{ assignment: { employeeProfileId: OID(103) } }, { assignment: { employeeProfileId: OID(103) } }],
    });

    const list = await service.listAllEmployees('APPROVED');
    const byCode = Object.fromEntries(list.map((e) => [e.employeeCode, e]));

    expect(byCode['EMP-1']).toMatchObject({ isLoggedIn: true, activeJobs: 0, mobile: '9000000001' });
    expect(byCode['EMP-2']).toMatchObject({ isLoggedIn: false, activeJobs: 0 });
    expect(byCode['EMP-3']).toMatchObject({ isLoggedIn: true, activeJobs: 2 });
  });

  it('only counts sessions that are neither logged out nor expired', async () => {
    const { service, sessionModel } = build({ profiles: [profileDoc(1)], users: [{ _id: OID(1), mobile: '9' }] });
    await service.listAllEmployees();
    const filter = sessionModel.distinct.mock.calls[0][1];
    expect(filter.revokedAt).toBeNull();
    expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
  });

  it('returns an empty list without extra queries when there are no employees', async () => {
    const { service, sessionModel } = build({ profiles: [] });
    expect(await service.listAllEmployees()).toEqual([]);
    expect(sessionModel.distinct).not.toHaveBeenCalled();
  });

  it('profile includes the phone number and real work stats', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const { service } = build({
      profiles: [profileDoc(1)],
      users: [{ _id: OID(1), mobile: '9848011111' }],
      pickups: [
        { status: 'COMPLETED', scheduledDate: '2026-11-01', totals: { netWeightGrams: 12500, totalAmount: 250000 } },
        { status: 'SETTLED', scheduledDate: '2026-11-02', totals: { netWeightGrams: 7500, totalAmount: 150050 } },
        { status: 'ON_THE_WAY', scheduledDate: today },
        { status: 'CANCELLED', scheduledDate: today },
      ],
    });

    const me = await service.getMyProfile(OID(1));
    expect(me.mobile).toBe('9848011111');
    expect(me.employeeCode).toBe('EMP-1');
    expect(me.stats).toEqual({
      totalAssigned: 4,
      completed: 2,
      openJobs: 1,
      todayJobs: 1,
      totalWeightKg: 20,
      totalPayoutRupees: 4000.5,
    });
  });

  it('demo employees are only seeded when SEED_DEMO_DATA=true', async () => {
    const { service } = build({ profiles: [] });
    const create = vi.fn();
    (service as any).userModel = { findOne: vi.fn(), create };
    const prev = process.env.SEED_DEMO_DATA;
    delete process.env.SEED_DEMO_DATA;
    try {
      await service.onModuleInit();
      expect(create).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.SEED_DEMO_DATA = prev;
    }
  });
});

describe('Logout', () => {
  const logout = (sessionModel: any, id?: string) => (IdentityService.prototype.logout as any).call({ sessionModel }, id);

  it('revokes every session in the same login family', async () => {
    const sessionModel = {
      findById: vi.fn(async () => ({ familyId: 'fam-1' })),
      updateMany: vi.fn(async () => ({})),
    };
    expect(await logout(sessionModel, OID(9))).toEqual({ loggedOut: true });
    expect(sessionModel.updateMany).toHaveBeenCalledWith(
      { familyId: 'fam-1', revokedAt: null },
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it('is harmless without a valid session id', async () => {
    const sessionModel = { findById: vi.fn(), updateMany: vi.fn() };
    expect(await logout(sessionModel, undefined)).toEqual({ loggedOut: true });
    expect(await logout(sessionModel, 'not-an-id')).toEqual({ loggedOut: true });
    expect(sessionModel.findById).not.toHaveBeenCalled();
  });
});

describe('Single .env validation', () => {
  const good = { MONGODB_URI: 'mongodb://x', JWT_ACCESS_SECRET: 's', ENCRYPTION_MASTER_KEY: 'a'.repeat(64) };

  it('accepts a complete configuration', () => {
    expect(validateEnv(good)).toBe(good);
  });

  it('names every missing setting instead of falling back to a default', () => {
    expect(() => validateEnv({})).toThrow(/MONGODB_URI[\s\S]*JWT_ACCESS_SECRET[\s\S]*ENCRYPTION_MASTER_KEY/);
  });

  it('rejects an encryption key that is not 64 hex characters', () => {
    expect(() => validateEnv({ ...good, ENCRYPTION_MASTER_KEY: 'short' })).toThrow(/64 hex/);
  });
});
