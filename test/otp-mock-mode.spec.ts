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
  function buildWithUser(user: any) {
    const otpModel: any = {
      findOne: vi.fn(() => ({ sort: vi.fn(async () => null) })),
      create: vi.fn(async (d: any) => d),
    };
    const userModel: any = { findOne: vi.fn(async () => user) };
    const sms = { sendOtp: vi.fn(async () => true) };
    const config = { get: (_k: string, f?: string) => f };
    const service = new IdentityService(userModel, {} as any, otpModel, {} as any, sms as any, {} as any, config as any);
    return { service, otpModel, sms };
  }
  const dto: any = { mobile: '9123456780', purpose: 'LOGIN', loginRole: 'EMPLOYEE' };

  it('refuses and sends nothing for a number with no employee account', async () => {
    const { service, otpModel, sms } = buildWithUser(null);
    const err: any = await service.sendOtp(dto).catch((e) => e);
    expect(err.getStatus()).toBe(404);
    expect(err.getResponse().details.code).toBe('EMPLOYEE_ACCOUNT_NOT_FOUND');
    expect(otpModel.create).not.toHaveBeenCalled();
    expect(sms.sendOtp).not.toHaveBeenCalled();
  });

  it('also refuses a customer-only account', async () => {
    const { service } = buildWithUser({ roles: ['CUSTOMER'], status: 'ACTIVE' });
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a suspended employee', async () => {
    const { service } = buildWithUser({ roles: ['EMPLOYEE'], status: 'SUSPENDED' });
    await expect(service.sendOtp(dto)).rejects.toMatchObject({ status: 403 });
  });

  it('sends the OTP for a real employee', async () => {
    const { service, sms } = buildWithUser({ roles: ['EMPLOYEE'], status: 'ACTIVE' });
    const res = await service.sendOtp(dto);
    expect(res.message).toBe('OTP sent successfully');
    expect(sms.sendOtp).toHaveBeenCalled();
  });

  it('customer-app OTP requests (no loginRole) are unchanged', async () => {
    const { service, sms } = buildWithUser(null);
    await service.sendOtp({ mobile: '9123456780', purpose: 'LOGIN' } as any);
    expect(sms.sendOtp).toHaveBeenCalled();
  });

  it('verifying with requestedRole EMPLOYEE cannot create an employee out of thin air', async () => {
    const { service } = buildWithUser(null);
    await expect(
      service.verifyOtp({ mobile: '9123456780', code: '123456', purpose: 'LOGIN', requestedRole: 'EMPLOYEE' } as any),
    ).rejects.toMatchObject({ status: 404 });
  });
});
