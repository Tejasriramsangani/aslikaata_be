import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdentityService } from '../src/modules/identity/identity.service.js';

function build(smsProvider: string | undefined) {
  const created: any[] = [];
  const otpModel: any = {
    findOne: vi.fn(() => ({ sort: vi.fn(async () => null) })),
    create: vi.fn(async (doc: any) => {
      created.push(doc);
      return doc;
    }),
  };
  const sms = { sendOtp: vi.fn(async () => true) };
  const config = {
    get: (key: string, fallback?: string) => (key === 'SMS_PROVIDER' ? (smsProvider ?? fallback) : fallback),
  };
  const service = new IdentityService(
    {} as any, // user
    {} as any, // session
    otpModel,
    {} as any, // admin credential
    sms as any,
    {} as any, // jwt
    config as any,
    {} as any, // employee profile
  );
  return { service, sms, created };
}

describe('OTP mock mode (SMS_PROVIDER=mock)', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('returns the generated OTP so the app can display it', async () => {
    const { service, sms } = build('mock');
    const res = await service.sendOtp({ mobile: '9848011111', purpose: 'LOGIN' } as any);

    expect(res.devOtp).toMatch(/^\d{6}$/);
    // It is the very same code that was handed to the SMS service.
    expect(sms.sendOtp).toHaveBeenCalledWith('9848011111', res.devOtp, 'LOGIN');
  });

  it('defaults to mock mode when SMS_PROVIDER is not set', async () => {
    const { service } = build(undefined);
    const res = await service.sendOtp({ mobile: '9848011111', purpose: 'LOGIN' } as any);
    expect(res.devOtp).toBeDefined();
  });

  it('never returns the OTP with a real SMS provider', async () => {
    const { service } = build('fast2sms');
    const res = await service.sendOtp({ mobile: '9848011111', purpose: 'LOGIN' } as any);
    expect(res).not.toHaveProperty('devOtp');
  });

  it('never returns the OTP in production, even if the provider is mock', async () => {
    process.env.NODE_ENV = 'production';
    const { service } = build('mock');
    const res = await service.sendOtp({ mobile: '9848011111', purpose: 'LOGIN' } as any);
    expect(res).not.toHaveProperty('devOtp');
  });

  it('only stores a hash of the OTP', async () => {
    const { service, created } = build('mock');
    const res = await service.sendOtp({ mobile: '9848011111', purpose: 'LOGIN' } as any);
    expect(JSON.stringify(created[0])).not.toContain(res.devOtp as string);
  });
});

describe('Employee login: no account -> no OTP', () => {
  /** users: matching user records; profiles: employee profiles ({ userId, status }). */
  function build(users: any[], profiles: any[] = []) {
    const otpModel: any = {
      findOne: vi.fn(() => ({ sort: vi.fn(async () => null) })),
      create: vi.fn(async (d: any) => d),
    };
    const userModel: any = {
      find: vi.fn(async () => users),
      findOne: vi.fn(async () => users[0] ?? null),
    };
    const profileModel: any = {
      find: vi.fn((q: any) => {
        const ids = q.userId.$in.map(String);
        const rows = profiles.filter((p) => ids.includes(String(p.userId)));
        return { select: () => ({ lean: async () => rows }) };
      }),
    };
    const sms = { sendOtp: vi.fn(async () => true) };
    const config = { get: (_k: string, f?: string) => f };
    const service = new IdentityService(
      userModel, {} as any, otpModel, {} as any, sms as any, {} as any, config as any, profileModel,
    );
    return { service, otpModel, sms };
  }
  const employee = (id: string, extra: any = {}) => ({ _id: id, roles: ['EMPLOYEE'], status: 'ACTIVE', ...extra });
  const approved = (id: string) => ({ userId: id, status: 'APPROVED' });
  const dto: any = { mobile: '9123456780', purpose: 'LOGIN', loginRole: 'EMPLOYEE' };

  it('refuses and sends nothing for a number with no employee account', async () => {
    const { service, otpModel, sms } = build([]);
    const err: any = await service.sendOtp(dto).catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse().details.code).toBe('EMPLOYEE_ACCOUNT_NOT_FOUND');
    expect(otpModel.create).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('also refuses a customer-only account', async () => {
    const { service } = build([{ _id: 'u1', roles: ['CUSTOMER'], status: 'ACTIVE' }]);
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an EMPLOYEE role with no employee profile (never approved)', async () => {
    const { service, sms } = build([employee('u1', { roles: ['CUSTOMER', 'EMPLOYEE'] })]);
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 404 });
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('refuses a rejected employee profile', async () => {
    const { service } = build([employee('u1')], [{ userId: 'u1', status: 'REJECTED' }]);
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a suspended user', async () => {
    const { service } = build([employee('u1', { status: 'SUSPENDED' })], [approved('u1')]);
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 403 });
  });

  it('refuses a suspended employee profile', async () => {
    const { service } = build([employee('u1')], [{ userId: 'u1', status: 'SUSPENDED' }]);
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 403 });
  });

  it('sends the OTP for an approved employee', async () => {
    const { service, sms } = build([employee('u1')], [approved('u1')]);
    const res = await service.sendOtp(dto);
    expect(res.message).toBe('OTP sent successfully');
    expect(sms.sendOtp).toHaveBeenCalled();
  });

  it('finds the approved record when the number is stored twice (98... and +9198...)', async () => {
    const { service, sms } = build([employee('dup'), employee('real')], [approved('real')]);
    await service.sendOtp(dto);
    expect(sms.sendOtp).toHaveBeenCalled();
  });

  it('customer-app OTP requests (no loginRole) are unchanged', async () => {
    const { service, sms } = build([]);
    await service.sendOtp({ mobile: '9123456780', purpose: 'LOGIN' } as any);
    expect(sms.sendOtp).toHaveBeenCalled();
  });

  it('verifying with requestedRole EMPLOYEE cannot create an employee out of thin air', async () => {
    const { service } = build([]);
    await expect(
      service.verifyOtp({ mobile: '9123456780', code: '123456', purpose: 'LOGIN', requestedRole: 'EMPLOYEE' } as any),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('verifying as EMPLOYEE refuses a role-only account (no profile)', async () => {
    const { service } = build([employee('u1', { roles: ['CUSTOMER', 'EMPLOYEE'] })]);
    await expect(
      service.verifyOtp({ mobile: '9123456780', code: '123456', purpose: 'LOGIN', requestedRole: 'EMPLOYEE' } as any),
    ).rejects.toMatchObject({ status: 404 });
  });
});
