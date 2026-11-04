import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEachForMulticast = vi.fn();
const cert = vi.fn((x: any) => x);
const initializeApp = vi.fn(() => ({ name: 'mock-app' }));
vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  cert: (x: any) => cert(x),
  initializeApp: (x: any) => initializeApp(x),
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({ sendEachForMulticast })),
}));

import { PushService, normalizePrivateKey } from '../src/modules/notifications/push.service.js';

const BODY = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'.repeat(3);
const PEM = `-----BEGIN PRIVATE KEY-----\n${BODY.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;

describe('normalizePrivateKey', () => {
  it('leaves a correct PEM alone', () => {
    expect(normalizePrivateKey(PEM)).toBe(PEM);
  });

  it('expands literal \\n sequences (unquoted .env values)', () => {
    expect(normalizePrivateKey(PEM.replace(/\n/g, '\\n'))).toBe(PEM);
  });

  it('removes wrapping quotes', () => {
    expect(normalizePrivateKey(`"${PEM}"`).trim()).toBe(PEM.trim());
  });

  it('rebuilds a key whose line breaks became spaces', () => {
    const flattened = PEM.replace(/\n/g, ' ');
    const fixed = normalizePrivateKey(flattened);
    expect(fixed.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
    expect(fixed.trim().endsWith('-----END PRIVATE KEY-----')).toBe(true);
    expect(fixed.replace(/\s/g, '')).toBe(PEM.replace(/\s/g, ''));
    expect(fixed.split('\n').every((l) => l.length <= 64)).toBe(true);
  });
});

describe('PushService credentials from FB_PROJECT_ID / FB_CLIENT_EMAIL / FB_PRIVATE_KEY', () => {
  const deviceModel: any = {
    find: vi.fn(() => ({ select: vi.fn(async () => [{ token: 't1' }]) })),
    deleteMany: vi.fn(),
  };
  const build = (env: Record<string, string>) => new PushService(deviceModel, { get: (k: string) => env[k] } as any);

  beforeEach(() => {
    sendEachForMulticast.mockReset();
    cert.mockClear();
    initializeApp.mockClear();
  });

  it('initialises Firebase from the three separate settings and sends', async () => {
    sendEachForMulticast.mockResolvedValue({ failureCount: 0, responses: [{ success: true }] });
    const svc = build({ FB_PROJECT_ID: 'my-proj', FB_CLIENT_EMAIL: 'svc@my-proj.iam.gserviceaccount.com', FB_PRIVATE_KEY: PEM });

    await svc.sendToUser('u1', { title: 'T', body: 'B' });

    expect(cert).toHaveBeenCalledWith({
      projectId: 'my-proj',
      clientEmail: 'svc@my-proj.iam.gserviceaccount.com',
      privateKey: PEM,
    });
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1);
  });

  it('still works when the key was pasted with escaped \\n or spaces', async () => {
    sendEachForMulticast.mockResolvedValue({ failureCount: 0, responses: [{ success: true }] });
    const svc = build({
      FB_PROJECT_ID: 'p',
      FB_CLIENT_EMAIL: 'e@p.iam.gserviceaccount.com',
      FB_PRIVATE_KEY: `"${PEM.replace(/\n/g, '\\n')}"`,
    });
    await svc.sendToUser('u1', { title: 'T', body: 'B' });
    expect(cert.mock.calls[0][0].privateKey).toBe(PEM);
  });

  it('does not send, and does not throw, when one of the three settings is missing', async () => {
    const svc = build({ FB_PROJECT_ID: 'p', FB_PRIVATE_KEY: PEM });
    await expect(svc.sendToUser('u1', { title: 'T', body: 'B' })).resolves.toBeUndefined();
    expect(initializeApp).not.toHaveBeenCalled();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('FB_* settings take priority over the older JSON setting', async () => {
    sendEachForMulticast.mockResolvedValue({ failureCount: 0, responses: [{ success: true }] });
    const svc = build({
      FB_PROJECT_ID: 'from-fb',
      FB_CLIENT_EMAIL: 'e@x.iam.gserviceaccount.com',
      FB_PRIVATE_KEY: PEM,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'from-json' }),
    });
    await svc.sendToUser('u1', { title: 'T', body: 'B' });
    expect(cert.mock.calls[0][0].projectId).toBe('from-fb');
  });
});
