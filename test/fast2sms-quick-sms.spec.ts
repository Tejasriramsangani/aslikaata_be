import { describe, it, expect, vi, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  Fast2SmsService,
  buildOtpMessage,
  fitSingleSms,
  toSmsSafeText,
} from '../src/modules/identity/sms/fast2sms.service.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';

const config = (values: Record<string, string>) => ({
  get: (key: string, fallback?: string) => values[key] ?? fallback,
});

describe('Quick SMS message helpers', () => {
  it('keeps OTP messages inside a single plain-text SMS', () => {
    for (const purpose of ['LOGIN', 'PICKUP_COMPLETION']) {
      const msg = buildOtpMessage('123456', purpose);
      expect(msg.length).toBeLessThanOrEqual(160);
      expect(toSmsSafeText(msg)).toBe(msg);
      expect(msg.startsWith('123456')).toBe(true);
    }
  });

  it('strips emoji and smart punctuation', () => {
    expect(toSmsSafeText('Welcome 🎉 “Asli” – Kaata’s ₹50')).toBe(`Welcome "Asli" - Kaata's Rs.50`);
  });

  it('truncates long text to 160 characters', () => {
    const out = fitSingleSms('x'.repeat(400));
    expect(out.length).toBe(160);
    expect(out.endsWith('...')).toBe(true);
  });
});

describe('Fast2SmsService (Quick SMS route)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('rejects HTTP 401 without logging a development OTP', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 401, json: async () => ({ return: true, message: 'Invalid Authentication' }) })));
    const svc = new Fast2SmsService(config({ FAST2SMS_API_KEY: 'test-key' }) as any);
    expect(await svc.sendOtp('9876000000', '314159', 'LOGIN')).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('314159');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('9876000000');
  });

  it('sends OTPs on route q with a plain-text message and a clean 10-digit number', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ return: true, request_id: 'r1' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new Fast2SmsService(config({ FAST2SMS_API_KEY: 'k' }) as any);

    expect(await svc.sendOtp('+91 98480-11111', '654321', 'LOGIN')).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body).toMatchObject({ route: 'q', numbers: '9848011111' });
    expect(body.message).toContain('654321');
    expect(body.variables_values).toBeUndefined();
  });

  it('uses the OTP route when FAST2SMS_ROUTE=otp', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, json: async () => ({ return: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new Fast2SmsService(config({ FAST2SMS_API_KEY: 'k', FAST2SMS_ROUTE: 'otp' }) as any);

    await svc.sendOtp('9848011111', '654321', 'LOGIN');
    expect(JSON.parse((fetchMock.mock.calls[0] as any)[1].body)).toMatchObject({ route: 'otp', variables_values: '654321' });
  });

  it('returns false when Fast2SMS rejects the request (e.g. low balance)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 400, json: async () => ({ return: false, status_code: 412, message: 'Low balance' }) })));
    const svc = new Fast2SmsService(config({ FAST2SMS_API_KEY: 'k' }) as any);
    expect(await svc.sendText('9848011111', 'hello')).toBe(false);
  });
});

describe('IdentityService when the SMS cannot be sent', () => {
  it('removes the OTP challenge and returns a clear error instead of "OTP sent"', async () => {
    const otpModel: any = {
      findOne: vi.fn(() => ({ sort: vi.fn(async () => null) })),
      create: vi.fn(async (doc: any) => ({ ...doc, _id: 'c1' })),
      deleteOne: vi.fn(async () => ({})),
    };
    const sms = { sendOtp: vi.fn(async () => false) };
    const service = new IdentityService(
      {} as any, {} as any, otpModel, {} as any, sms as any, {} as any,
      config({ SMS_PROVIDER: 'fast2sms' }) as any,
      {} as any, // employee profile
    );

    const err: any = await service.sendOtp({ mobile: '9848011111', purpose: 'LOGIN' } as any).catch((e) => e);
    expect(err.status).toBe(503);
    expect(otpModel.deleteOne).toHaveBeenCalledWith({ _id: 'c1' });
  });
});
