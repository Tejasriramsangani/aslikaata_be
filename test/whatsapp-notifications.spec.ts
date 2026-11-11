import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsappNotificationsService } from '../src/modules/notifications/whatsapp-notifications.service.js';
import { whatsappKeysForEvent, whatsappVariables } from '../src/modules/notifications/whatsapp-notification-plan.js';
import { WhatsappWebhookController } from '../src/modules/notifications/whatsapp-webhook.controller.js';
import { Fast2SmsWhatsappService } from '../src/modules/identity/sms/fast2sms-whatsapp.service.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import { CryptoUtil } from '../src/common/utils/crypto.util.js';

const config = (values: Record<string, string>) => ({ get: (key: string, fallback?: string) => values[key] ?? fallback });
const ids = { pickup: '640000000000000000000001', customer: '640000000000000000000002', employee: '640000000000000000000003' };
const enabled = { SMS_PROVIDER: 'fast2sms', FAST2SMS_CHANNEL: 'whatsapp', FAST2SMS_WA_API_KEY: 'unit-test-key',
  FAST2SMS_WA_NOTIFICATIONS_ENABLED: 'true', FAST2SMS_WA_NOTIFICATIONS_SINCE: '2020-01-01T00:00:00.000Z' };
const templateConfig = { ...enabled, FAST2SMS_WA_PHONE_NUMBER_ID: 'unit-test-sender', FAST2SMS_WA_OTP_TEMPLATE_ID: '42871',
  FAST2SMS_WA_SIGNUP_OTP_TEMPLATE_ID: '42921', FAST2SMS_WA_PICKUP_REQUEST_RECEIVED_TEMPLATE_ID: '42922',
  FAST2SMS_WA_PICKUP_CONFIRMED_TEMPLATE_ID: '42923', FAST2SMS_WA_EMPLOYEE_ASSIGNED_TEMPLATE_ID: '42924',
  FAST2SMS_WA_PICKUP_CANCELLED_TEMPLATE_ID: '42926', FAST2SMS_WA_PICKUP_COMPLETED_PAYMENT_TEMPLATE_ID: '42929' };
const pickupFixture = () => ({ _id: ids.pickup, customerId: ids.customer, pickupCode: 'UNIT-PICKUP', status: 'ASSIGNED',
  scheduledDate: '2026-11-10', timeSlotSnapshot: { displayLabel: '10 AM - 12 PM' },
  assignment: { employeeProfileId: ids.employee, employeeName: 'Test Partner', assignedAt: new Date('2026-11-09T10:00:00Z') },
  totals: { netWeightGrams: 12500, totalAmount: 25050 } });
const settlementFixture = () => ({ status: 'COMPLETED', type: 'CASH', amount: 25050 });
function fixture(overrides: Record<string, string> = {}) {
  const rows = new Map<string, any>(), pickup = pickupFixture();
  const jobs = {
    create: vi.fn(async (doc: any) => { const id = String(doc._id); if (rows.has(id)) throw { code: 11000 }; rows.set(id, doc); return doc; }),
    find: vi.fn(() => ({ sort: () => ({ limit: async () => [...rows.values()].filter(row => row.status === 'PENDING') }) })),
    findOneAndUpdate: vi.fn(async (filter: any) => { const row = rows.get(String(filter._id)); if (!row || row.status !== filter.status) return null; row.status = 'PROCESSING'; return row; }),
    updateOne: vi.fn(async (filter: any, update: any) => {
      const row = rows.get(String(filter._id)); if (row) {
        if (filter.status && row.status !== filter.status) return { matchedCount: 0 };
        for (const [path, value] of Object.entries(update.$set)) {
          const parts = path.split('.'); let target = row;
          for (const part of parts.slice(0, -1)) target = target[part] ??= {};
          target[parts.at(-1)!] = value;
        }
      }
      return { matchedCount: row ? 1 : 0 };
    }),
  };
  const pickups = { findById: vi.fn(async () => pickup) };
  const users = { findById: vi.fn(async () => ({ mobile: '9000000001', status: 'ACTIVE', roles: ['CUSTOMER'] })) };
  const profiles = { findOne: vi.fn(async () => ({ fullName: 'Unit Customer' })) };
  const settlements = { findOne: vi.fn(async () => settlementFixture()) };
  const sms = { sendTemplate: vi.fn(async (_mobile: string, _template: unknown) => ({ accepted: true, requestId: 'unit-request', httpStatus: 200 })) };
  const service = new WhatsappNotificationsService(jobs as any, pickups as any, users as any, profiles as any,
    settlements as any, config({ ...enabled, ...overrides }) as any, sms as any);
  const event = (toStatus: string, fromStatus = 'SCHEDULED') => service.handleDomainEvent('pickup.status_changed', { pickupId: ids.pickup, fromStatus, toStatus }, new Date());
  return { service, jobs, rows, pickup, pickups, users, profiles, settlements, sms, event };
}
afterEach(() => vi.unstubAllGlobals());

describe('approved WhatsApp template mapping and transport', () => {
  for (const [purpose, messageId] of [['LOGIN', '42871'], ['SIGNUP', '42921']]) {
    it(`uses approved authentication mapping for ${purpose}`, async () => {
      const fetchMock = vi.fn(async (_url: string, _init?: unknown) => ({ status: 200, json: async () => ({ status: true, request_id: 'unit-request' }) }));
      vi.stubGlobal('fetch', fetchMock);
      const service = new Fast2SmsWhatsappService(config(templateConfig) as any);
      const generatedForTest = String(100000 + Math.floor(Math.random() * 900000));
      expect(await service.sendOtp('9000000001', generatedForTest, purpose)).toBe(true);
      const query = new URL(fetchMock.mock.calls[0][0] as any).searchParams;
      expect(query.get('message_id')).toBe(messageId);
      expect(query.get('variables_values')).toBe(generatedForTest);
      expect(query.get('phone_number_id')).toBe(templateConfig.FAST2SMS_WA_PHONE_NUMBER_ID);
    });
  }
  const mappings = [
    ['PICKUP_REQUEST_RECEIVED', '42922', ['Unit Customer', 'UNIT-PICKUP']],
    ['PICKUP_CONFIRMED', '42923', ['Unit Customer', 'UNIT-PICKUP', '10/11/2026', '10 AM - 12 PM']],
    ['EMPLOYEE_ASSIGNED', '42924', ['Unit Customer', 'UNIT-PICKUP', 'Test Partner']],
    ['PICKUP_CANCELLED', '42926', ['Unit Customer', 'UNIT-PICKUP']],
    ['PICKUP_COMPLETED_PAYMENT', '42929', ['Unit Customer', 'UNIT-PICKUP', '12.500', '250.50', 'CASH']],
  ] as const;
  for (const [key, messageId, variables] of mappings) it(`uses ${key} message and exact variable order`, async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => ({ status: 200, json: async () => ({ status: true, request_id: 'unit-request' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new Fast2SmsWhatsappService(config(templateConfig) as any);
    expect((await service.sendTemplate('9000000001', { key, variables: [...variables] })).accepted).toBe(true);
    const query = new URL(fetchMock.mock.calls[0][0]).searchParams;
    expect(query.get('message_id')).toBe(messageId);
    expect(query.get('variables_values')).toBe(variables.join('|'));
    expect(query.get('numbers')).toBe('9000000001');
  });
  for (const [status, code] of [[400, 'PROVIDER'], [401, 'AUTHORIZATION'], [429, 'RATE_LIMIT']] as const) it(`records HTTP ${status} without falsely accepting delivery`, async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status, json: async () => ({ status: false, message: 'unit provider error' }) })));
    const result = await new Fast2SmsWhatsappService(config(templateConfig) as any).sendTemplate('9000000001', { key: 'PICKUP_CANCELLED', variables: ['Name', 'Code'] });
    expect(result).toMatchObject({ accepted: false, httpStatus: status, errorCode: code });
  });
  it('treats timeout as ambiguous and does not retry', async () => {
    const fetchMock = vi.fn(async () => { throw Object.assign(new Error('request timed out'), { name: 'TimeoutError' }); });
    vi.stubGlobal('fetch', fetchMock);
    const result = await new Fast2SmsWhatsappService(config(templateConfig) as any).sendTemplate('9000000001', { key: 'PICKUP_CANCELLED', variables: ['Name', 'Code'] });
    expect(result).toMatchObject({ accepted: false, ambiguous: true, errorCode: 'TIMEOUT' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('classifies invalid/disconnected sender configuration without storing provider text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 400, json: async () => ({ status: false, message: 'WhatsApp Phone Number ID is invalid or not connected.' }) })));
    const result = await new Fast2SmsWhatsappService(config(templateConfig) as any).sendTemplate('9000000001', { key: 'PICKUP_CANCELLED', variables: ['Name', 'Code'] });
    expect(result).toMatchObject({ accepted: false, errorCode: 'CONFIGURATION' });
    expect(result).not.toHaveProperty('message');
  });
  it('sends an opaque outbox correlation ID for webhook-before-response races', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ status: 200, json: async () => ({ status: true, request_id: 'unit-request' }) }));
    vi.stubGlobal('fetch', fetchMock);
    await new Fast2SmsWhatsappService(config(templateConfig) as any).sendTemplate('9000000001', { key: 'PICKUP_CANCELLED', variables: ['Name', 'Code'], correlationId: ids.pickup });
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('udf1')).toBe(ids.pickup);
  });
  it('rejects missing configuration, invalid recipient, missing/extra/blank variables before fetch', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const service = new Fast2SmsWhatsappService(config(templateConfig) as any);
    for (const variables of [[], ['Name'], ['Name', 'Code', 'extra'], [' ', 'Code']]) {
      expect((await service.sendTemplate('9000000001', { key: 'PICKUP_CANCELLED', variables })).accepted).toBe(false);
    }
    expect((await service.sendTemplate('invalid', { key: 'PICKUP_CANCELLED', variables: ['Name', 'Code'] })).accepted).toBe(false);
    expect((await new Fast2SmsWhatsappService(config({}) as any).sendTemplate('9000000001', { key: 'PICKUP_CANCELLED', variables: ['Name', 'Code'] })).accepted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('persisted lifecycle mapping', () => {
  it('ignores scheduling, weighing approval, arrival and duplicate assignment side events', () => {
    for (const toStatus of ['SCHEDULED', 'CUSTOMER_CONFIRMED', 'ARRIVED', 'MEASURED'])
      expect(whatsappKeysForEvent('pickup.status_changed', { fromStatus: 'REQUESTED', toStatus })).toEqual([]);
    expect(whatsappKeysForEvent('pickup.assigned', {})).toEqual([]);
    expect(whatsappKeysForEvent('pickup.status_changed', { fromStatus: 'ASSIGNED', toStatus: 'ASSIGNED' })).toEqual([]);
  });
  it('builds all lifecycle variables from record snapshots', () => {
    const pickup = pickupFixture();
    expect(whatsappVariables('PICKUP_REQUEST_RECEIVED', pickup, 'Name')).toEqual(['Name', pickup.pickupCode]);
    expect(whatsappVariables('PICKUP_CONFIRMED', pickup, 'Name')).toEqual(['Name', pickup.pickupCode, '10/11/2026', '10 AM - 12 PM']);
    expect(whatsappVariables('EMPLOYEE_ASSIGNED', pickup, 'Name')).toEqual(['Name', pickup.pickupCode, 'Test Partner']);
    expect(whatsappVariables('PICKUP_CANCELLED', { ...pickup, status: 'CANCELLED' }, 'Name')).toEqual(['Name', pickup.pickupCode]);
  });
  it('requires completed collection AND matching successful cash/UPI payment; donation is not paid', () => {
    const pickup = { ...pickupFixture(), status: 'COMPLETED' }, settlement = settlementFixture();
    expect(whatsappVariables('PICKUP_COMPLETED_PAYMENT', pickup, 'Name', settlement)).toEqual(['Name', pickup.pickupCode, '12.500', '250.50', 'CASH']);
    for (const patch of [{ status: 'PENDING' }, { status: 'FAILED' }, { type: 'DONATE' }, { amount: 1 }, { amount: -1 }])
      expect(whatsappVariables('PICKUP_COMPLETED_PAYMENT', pickup, 'Name', { ...settlement, ...patch })).toBeNull();
    expect(whatsappVariables('PICKUP_COMPLETED_PAYMENT', { ...pickup, status: 'SETTLED' }, 'Name', settlement)).toBeNull();
    expect(whatsappVariables('PICKUP_COMPLETED_PAYMENT', pickup, '', settlement)).toBeNull();
  });
});

describe('existing OTP challenge flow and signup delivery classification', () => {
  function auth(account: object | null, overrides: Record<string, string> = {}, delivered = true) {
    const users = { findOne: vi.fn(async () => account) };
    const challenges = { findOne: vi.fn(() => ({ sort: async () => null })),
      create: vi.fn(async (input: any) => ({ ...input, _id: 'unit-challenge' })), deleteOne: vi.fn(async () => ({})) };
    const sms = { sendOtp: vi.fn(async (_mobile: string, _otp: string, _purpose: string) => delivered) };
    const service = new IdentityService(users as any, {} as any, challenges as any, {} as any, sms as any, {} as any,
      config({ ...enabled, FAST2SMS_WA_SIGNUP_OTP_ENABLED: 'true', ...overrides }) as any, {} as any);
    return { service, sms, challenges, users };
  }
  for (const [account, purpose] of [[{}, 'LOGIN'], [null, 'SIGNUP']] as const) it(`selects ${purpose} from trusted account existence after challenge creation`, async () => {
    const f = auth(account);
    const response = await f.service.sendOtp({ mobile: '9000000001', purpose: 'LOGIN' } as any);
    expect(f.sms.sendOtp.mock.calls[0][2]).toBe(purpose);
    expect(response.devOtp).toBeUndefined();
    expect(f.challenges.create.mock.invocationCallOrder[0]).toBeLessThan(f.sms.sendOtp.mock.invocationCallOrder[0]);
    expect(f.challenges.create.mock.calls[0][0]).toMatchObject({ purpose: 'LOGIN', maxAttempts: 3, attempts: 0 });
  });
  it('preserves normal login delivery and avoids account lookup when signup integration is disabled', async () => {
    const f = auth(null, { FAST2SMS_WA_SIGNUP_OTP_ENABLED: 'false' });
    await f.service.sendOtp({ mobile: '9000000001', purpose: 'LOGIN' } as any);
    expect(f.users.findOne).not.toHaveBeenCalled(); expect(f.sms.sendOtp.mock.calls[0][2]).toBe('LOGIN');
  });
  it('rejects failed signup delivery and removes its undelivered challenge', async () => {
    const f = auth(null, {}, false);
    await expect(f.service.sendOtp({ mobile: '9000000001', purpose: 'LOGIN' } as any)).rejects.toMatchObject({ status: 503 });
    expect(f.challenges.deleteOne).toHaveBeenCalledWith({ _id: 'unit-challenge' });
  });
  it('preserves generated mock challenge hashing without selecting a real provider template', async () => {
    const f = auth(null, { SMS_PROVIDER: 'mock' });
    const response = await f.service.sendOtp({ mobile: '9000000001', purpose: 'LOGIN' } as any);
    expect(f.users.findOne).not.toHaveBeenCalled();
    expect(f.challenges.create.mock.calls[0][0].codeHash).toBe(CryptoUtil.hashSha256(f.sms.sendOtp.mock.calls[0][1], '9000000001'));
    expect(response.cooldownSeconds).toBe(60);
  });
});

describe('WhatsApp outbox isolation, deduplication and trusted recipients', () => {
  it('does nothing without explicit opt-in, dedicated key, cutover or correct provider', async () => {
    for (const patch of [{ FAST2SMS_WA_NOTIFICATIONS_ENABLED: 'false' }, { FAST2SMS_WA_API_KEY: '' }, { FAST2SMS_WA_NOTIFICATIONS_SINCE: '' }, { SMS_PROVIDER: 'mock' }]) {
      const f = fixture(patch); await f.event('ASSIGNED'); await f.service.processPending();
      expect(f.pickups.findById).not.toHaveBeenCalled(); expect(f.jobs.find).not.toHaveBeenCalled(); expect(f.sms.sendTemplate).not.toHaveBeenCalled();
    }
  });
  it('ignores historical events before cutover', async () => {
    const f = fixture(); await f.service.handleDomainEvent('pickup.requested', { pickupId: ids.pickup }, new Date('2010-01-01'));
    expect(f.jobs.create).not.toHaveBeenCalled();
  });
  it('deduplicates simultaneous and repeated assignment events and dispatches exactly once', async () => {
    const f = fixture(); await Promise.all([f.event('ASSIGNED'), f.event('ASSIGNED')]);
    expect(f.rows.size).toBe(2);
    for (const id of f.rows.keys()) await Promise.all([f.service.deliver(id), f.service.deliver(id)]);
    expect(f.sms.sendTemplate).toHaveBeenCalledTimes(2);
    expect(f.sms.sendTemplate.mock.calls.every(call => call[0] === '9000000001')).toBe(true);
    expect([...f.rows.values()].every(row => row.payload.delivery.requestId === 'unit-request' && row.status === 'PUBLISHED')).toBe(true);
    await f.event('ASSIGNED'); await f.service.processPending(); expect(f.sms.sendTemplate).toHaveBeenCalledTimes(2);
  });
  it('does not queue before successful cancellation or reserve payment notice before completion', async () => {
    const f = fixture(); await f.event('CANCELLED'); await f.event('SETTLED', 'CUSTOMER_CONFIRMED');
    expect(f.rows.size).toBe(0);
    f.pickup.status = 'COMPLETED'; await f.event('COMPLETED', 'INVOICED'); await f.service.processPending();
    expect(f.sms.sendTemplate).toHaveBeenCalledTimes(1);
  });
  it('does not send to deleted/noncustomer accounts or use event-provided phone/name', async () => {
    const f = fixture(); f.users.findById.mockResolvedValue({ mobile: '9000000001', status: 'DELETED', roles: ['EMPLOYEE'] });
    await f.service.handleDomainEvent('pickup.requested', { pickupId: ids.pickup, mobile: 'untrusted', customerName: 'untrusted' }, new Date());
    await f.service.processPending(); expect(f.sms.sendTemplate).not.toHaveBeenCalled();
  });
  it('suppresses queued assignment after cancellation and outdated partner snapshots', async () => {
    const f = fixture(); await f.event('ASSIGNED'); f.pickup.status = 'CANCELLED'; await f.service.processPending();
    expect(f.sms.sendTemplate).not.toHaveBeenCalled();
  });
  it('records failure/ambiguity and never blindly retries lost provider responses', async () => {
    const f = fixture(); f.sms.sendTemplate.mockRejectedValue(new Error('timeout'));
    await f.service.handleDomainEvent('pickup.requested', { pickupId: ids.pickup }, new Date()); await f.service.processPending();
    expect([...f.rows.values()][0].payload.delivery.state).toBe('UNKNOWN');
    await f.service.handleDomainEvent('pickup.requested', { pickupId: ids.pickup }, new Date()); await f.service.processPending();
    expect(f.sms.sendTemplate).toHaveBeenCalledTimes(1);
  });
  it('does not overwrite an early delivered webhook with a lost HTTP response', async () => {
    const f = fixture();
    f.sms.sendTemplate.mockImplementation(async (_mobile, template: any) => {
      await f.service.recordDelivery('unit-request', 'delivered', template.correlationId);
      throw new Error('response lost after delivery');
    });
    await f.service.handleDomainEvent('pickup.requested', { pickupId: ids.pickup }, new Date()); await f.service.processPending();
    const row = [...f.rows.values()][0];
    expect(row.status).toBe('PUBLISHED'); expect(row.payload.delivery.providerStatus).toBe('delivered');
    await f.service.processPending(); expect(f.sms.sendTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('authenticated delivery webhook', () => {
  it('rejects disabled/missing/incorrect secrets before any writes', async () => {
    const recordDelivery = vi.fn(), secret = 'unit-webhook-secret-with-more-than-32-chars';
    const body = { request_id: 'unit-request', status: 'delivered' };
    for (const [values, supplied] of [[{}, secret], [{ FAST2SMS_WA_WEBHOOK_ENABLED: 'true', FAST2SMS_WA_WEBHOOK_SECRET: secret }, 'wrong']]) {
      const controller = new WhatsappWebhookController(config(values as any) as any, { recordDelivery } as any);
      await expect(controller.receive(supplied as string, body)).rejects.toBeDefined();
    }
    expect(recordDelivery).not.toHaveBeenCalled();
  });
  it('retains only allowed provider request/status and rejects malformed callbacks', async () => {
    const secret = 'unit-webhook-secret-with-more-than-32-chars', recordDelivery = vi.fn();
    const controller = new WhatsappWebhookController(config({ FAST2SMS_WA_WEBHOOK_ENABLED: 'true', FAST2SMS_WA_WEBHOOK_SECRET: secret }) as any, { recordDelivery } as any);
    expect(await controller.receive(secret, { request_id: 'unit-request', status: 'delivered', mobile: 'ignored', body: 'ignored' })).toEqual({ received: true });
    expect(recordDelivery).toHaveBeenCalledWith('unit-request', 'delivered');
    await expect(controller.receive(secret, { request_id: 'unit-request', status: 'received' })).rejects.toBeDefined();
  });
  it('uses monotonic guards so stale failure/sent callbacks cannot overwrite delivered/read', async () => {
    const f = fixture(); await f.service.recordDelivery('unit-request', 'failed');
    expect(f.jobs.updateOne.mock.calls[0][0]['payload.delivery.providerStatus'].$in).not.toContain('delivered');
    await f.service.recordDelivery('unit-request', 'sent');
    expect(f.jobs.updateOne.mock.calls[1][0]['payload.delivery.providerStatus'].$in).not.toContain('read');
  });
});
