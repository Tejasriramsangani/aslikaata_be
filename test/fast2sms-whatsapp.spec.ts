import { describe, it, expect, vi, afterEach } from 'vitest';
import { Fast2SmsWhatsappService, toWhatsappVariable } from '../src/modules/identity/sms/fast2sms-whatsapp.service.js';

const env = {
  FAST2SMS_API_KEY: 'k',
  FAST2SMS_WA_PHONE_NUMBER_ID: 'PNID',
  FAST2SMS_WA_OTP_TEMPLATE_ID: '11',
  FAST2SMS_WA_PICKUP_OTP_TEMPLATE_ID: '12',
  FAST2SMS_WA_PICKER_APPROVED_TEMPLATE_ID: '13',
};
const config = (values: Record<string, string>) => ({ get: (k: string, f?: string) => values[k] ?? f });
const ok = () => vi.fn(async (_url: string, _init?: any) => ({ status: 200, json: async () => ({ status: true, request_id: 'r1' }) }));
const fail = () => vi.fn(async (_url: string, _init?: any) => ({ status: 400, json: async () => ({ status: false, message: 'Not on WhatsApp' }) }));
const query = (fetchMock: any) => new URL(fetchMock.mock.calls[0][0]).searchParams;

describe('Fast2SmsWhatsappService', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends login OTP with the OTP template', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    const svc = new Fast2SmsWhatsappService(config(env) as any);
    expect(await svc.sendOtp('+919848011111', '654321', 'LOGIN')).toBe(true);
    const q = query(f);
    expect(q.get('message_id')).toBe('11');
    expect(q.get('phone_number_id')).toBe('PNID');
    expect(q.get('numbers')).toBe('9848011111');
    expect(q.get('variables_values')).toBe('654321');
    expect(f.mock.calls[0][1].headers.authorization).toBe('k');
  });

  it('uses the pickup template for PICKUP_COMPLETION', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    await new Fast2SmsWhatsappService(config(env) as any).sendOtp('9848011111', '1', 'PICKUP_COMPLETION');
    expect(query(f).get('message_id')).toBe('12');
  });

  it('sends texts with their template variables', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    await new Fast2SmsWhatsappService(config(env) as any).sendText('9848011111', 'x', {
      key: 'PICKER_APPROVED',
      variables: ['EMP|01'],
    });
    expect(query(f).get('message_id')).toBe('13');
    expect(query(f).get('variables_values')).toBe('EMP/01');
  });

  it('falls back to SMS when WhatsApp fails', async () => {
    vi.stubGlobal('fetch', fail());
    const sms = { sendOtp: vi.fn(async () => true), sendText: vi.fn(async () => true) };
    const svc = new Fast2SmsWhatsappService(config(env) as any, sms);
    expect(await svc.sendOtp('9848011111', '654321', 'LOGIN')).toBe(true);
    expect(sms.sendOtp).toHaveBeenCalledWith('9848011111', '654321', 'LOGIN');
  });

  it('falls back to SMS for a text with no WhatsApp template', async () => {
    const f = ok();
    vi.stubGlobal('fetch', f);
    const sms = { sendOtp: vi.fn(async () => true), sendText: vi.fn(async () => true) };
    const svc = new Fast2SmsWhatsappService(config(env) as any, sms);
    await svc.sendText('9848011111', 'msg', { key: 'PICKER_REJECTED', variables: ['a', 'b'] });
    expect(f).not.toHaveBeenCalled();
    expect(sms.sendText).toHaveBeenCalled();
  });

  it('returns false without fallback when WhatsApp fails', async () => {
    vi.stubGlobal('fetch', fail());
    expect(await new Fast2SmsWhatsappService(config(env) as any).sendOtp('9848011111', '1', 'LOGIN')).toBe(false);
  });

  it('cleans variables', () => {
    expect(toWhatsappVariable(' a|b\n\nc    d ')).toBe('a/b c d');
  });
});
