import { describe, it, expect } from 'vitest';
import { whatsappSetupReport, WHATSAPP_TEMPLATE_VARIABLES } from '../src/modules/notifications/whatsapp-setup.js';

const from = (values: Record<string, string>) => (key: string) => values[key];

/** What the backend .env had when only the login OTP was working. */
const otpOnly = {
  SMS_PROVIDER: 'fast2sms',
  FAST2SMS_CHANNEL: 'whatsapp',
  FAST2SMS_API_KEY: 'main-key',
  FAST2SMS_WA_PHONE_NUMBER_ID: '1470501442805143',
  FAST2SMS_WA_OTP_TEMPLATE_ID: '42871',
};

describe('WhatsApp setup report (what is missing in .env)', () => {
  it('reports the OTP-only setup: login OTP ready, customer updates off, every other template missing', () => {
    const report = whatsappSetupReport(from(otpOnly));
    expect(report.channelOn).toBe(true);
    expect(report.otpReady).toBe(true);
    expect(report.customerUpdatesOn).toBe(false);
    expect(report.missing).toEqual(
      expect.arrayContaining([
        'FAST2SMS_WA_API_KEY (needed for customer updates)',
        'FAST2SMS_WA_NOTIFICATIONS_ENABLED=true',
        ...Object.values(WHATSAPP_TEMPLATE_VARIABLES),
      ]),
    );
    expect(report.missing.some((m) => m.startsWith('FAST2SMS_WA_NOTIFICATIONS_SINCE'))).toBe(true);
    // the login OTP settings are not reported as missing
    expect(report.missing).not.toContain('FAST2SMS_WA_OTP_TEMPLATE_ID');
    expect(report.missing).not.toContain('FAST2SMS_WA_PHONE_NUMBER_ID');
  });

  it('reports a complete setup with nothing missing', () => {
    const full: Record<string, string> = {
      ...otpOnly,
      FAST2SMS_WA_API_KEY: 'wa-key',
      FAST2SMS_WA_NOTIFICATIONS_ENABLED: 'true',
      FAST2SMS_WA_NOTIFICATIONS_SINCE: '2026-11-11T00:00:00Z',
      ...Object.fromEntries(Object.values(WHATSAPP_TEMPLATE_VARIABLES).map((v) => [v, '1'])),
    };
    const report = whatsappSetupReport(from(full));
    expect(report).toEqual({ channelOn: true, otpReady: true, customerUpdatesOn: true, missing: [] });
  });

  it('customer updates stay off without the dedicated key even when the flag and date are set', () => {
    const report = whatsappSetupReport(
      from({ ...otpOnly, FAST2SMS_WA_NOTIFICATIONS_ENABLED: 'true', FAST2SMS_WA_NOTIFICATIONS_SINCE: '2026-11-11T00:00:00Z' }),
    );
    expect(report.customerUpdatesOn).toBe(false);
    expect(report.missing).toContain('FAST2SMS_WA_API_KEY (needed for customer updates)');
  });

  it('says nothing when WhatsApp is not the channel (mock or plain SMS)', () => {
    expect(whatsappSetupReport(from({ SMS_PROVIDER: 'mock' }))).toEqual({
      channelOn: false,
      otpReady: false,
      customerUpdatesOn: false,
      missing: [],
    });
    expect(whatsappSetupReport(from({ SMS_PROVIDER: 'fast2sms', FAST2SMS_CHANNEL: 'sms' })).channelOn).toBe(false);
  });

  it('flags a missing sender or OTP template as login OTP not ready', () => {
    const report = whatsappSetupReport(from({ SMS_PROVIDER: 'fast2sms', FAST2SMS_CHANNEL: 'whatsapp', FAST2SMS_API_KEY: 'k' }));
    expect(report.otpReady).toBe(false);
    expect(report.missing).toEqual(expect.arrayContaining(['FAST2SMS_WA_PHONE_NUMBER_ID', 'FAST2SMS_WA_OTP_TEMPLATE_ID']));
  });
});
