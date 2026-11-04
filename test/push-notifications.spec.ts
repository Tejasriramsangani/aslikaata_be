import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEachForMulticast = vi.fn();
vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  cert: vi.fn((x: any) => x),
  initializeApp: vi.fn(() => ({ name: 'mock-app' })),
}));
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({ sendEachForMulticast })),
}));

import { planNotifications, formatScheduledDate } from '../src/modules/notifications/notification-templates.js';
import { PushService } from '../src/modules/notifications/push.service.js';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { OutboxService } from '../src/modules/outbox/outbox.service.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');

describe('planNotifications (customer + employee account messages)', () => {
  const base = { pickupId: OID(1), pickupCode: 'AK-10245', customerId: OID(2) };

  it('tells the customer a picker is assigned, using the picker name', () => {
    const [n] = planNotifications('pickup.status_changed', { ...base, toStatus: 'ASSIGNED' }, { employeeName: 'Ravi' });
    expect(n).toMatchObject({ userId: OID(2), type: 'PICKUP_ASSIGNED', title: 'Picker assigned' });
    expect(n.body).toContain('Ravi');
    expect(n.body).toContain('AK-10245');
    expect(n.data).toMatchObject({ pickupId: OID(1), pickupCode: 'AK-10245' });
  });

  it('tells the customer the picker is on the way / arrived', () => {
    const [a] = planNotifications('pickup.status_changed', { ...base, toStatus: 'ON_THE_WAY' });
    const [b] = planNotifications('pickup.status_changed', { ...base, toStatus: 'ARRIVED' });
    expect(a.type).toBe('PICKUP_ON_THE_WAY');
    expect(b.type).toBe('PICKUP_ARRIVED');
  });

  it('"nearby" message names the executive, asks for the pickup QR, and opens that pickup', () => {
    const [n] = planNotifications(
      'pickup.status_changed',
      { ...base, toStatus: 'ARRIVED' },
      { employeeName: 'Ramesh Kumar' },
    );
    expect(n.title).toBe('Your pickup executive is nearby');
    expect(n.body).toContain('Ramesh Kumar is here for pickup AK-10245');
    expect(n.body).toMatch(/show your pickup QR code to continue/i);
    expect(n.data).toMatchObject({ pickupId: OID(1), pickupCode: 'AK-10245', type: 'PICKUP_ARRIVED' });

    const [anonymous] = planNotifications('pickup.status_changed', { ...base, toStatus: 'ARRIVED' });
    expect(anonymous.body).toContain('Your pickup executive is here for pickup');
  });

  it('postpones with the admin reason and the new date + slot', () => {
    const [n] = planNotifications('pickup.status_changed', {
      ...base,
      action: 'RESCHEDULED',
      actor: 'ADMIN',
      scheduledDate: '2026-11-05',
      timeSlot: '10 AM - 12 PM',
      reason: 'Heavy crowd today',
    });
    expect(n.type).toBe('PICKUP_POSTPONED');
    expect(n.body).toContain('5 Nov 2026');
    expect(n.body).toContain('10 AM - 12 PM');
    expect(n.body).toContain('Heavy crowd today');
  });

  it('does not invent a reason when the admin gave none', () => {
    const [n] = planNotifications('pickup.status_changed', {
      ...base, action: 'RESCHEDULED', actor: 'ADMIN', scheduledDate: '2026-11-05',
    });
    expect(n.body).not.toContain('Reason');
  });

  it('does not push the customer about their own reschedule or cancel', () => {
    expect(planNotifications('pickup.status_changed', { ...base, action: 'RESCHEDULED', actor: 'CUSTOMER', scheduledDate: '2026-11-05' })).toEqual([]);
    expect(planNotifications('pickup.status_changed', { ...base, toStatus: 'CANCELLED', actorRole: 'CUSTOMER' })).toEqual([]);
  });

  it('tells the customer when admin cancels', () => {
    const [n] = planNotifications('pickup.status_changed', { ...base, toStatus: 'CANCELLED', actorRole: 'ADMIN', reason: 'Vehicle breakdown' });
    expect(n.type).toBe('PICKUP_CANCELLED');
    expect(n.body).toContain('Vehicle breakdown');
  });

  it('formats the summary total from paise to rupees', () => {
    const [n] = planNotifications('summary.ready', { ...base, totalAmount: 123450 });
    expect(n.body).toContain('₹1234.50');
  });

  it('notifies employees about approval and rejected documents', () => {
    const [a] = planNotifications('employee.approved', { employeeUserId: OID(9) });
    expect(a).toMatchObject({ userId: OID(9), type: 'ACCOUNT_APPROVED' });
    const [b] = planNotifications('employee.document_rejected', { employeeUserId: OID(9), docType: 'DRIVING_LICENSE', rejectionReason: 'Blurry' });
    expect(b.body).toContain('driving license');
    expect(b.body).toContain('Blurry');
  });

  it('ignores intermediate statuses and events with no customer', () => {
    expect(planNotifications('pickup.status_changed', { ...base, toStatus: 'MEASURED' })).toEqual([]);
    expect(planNotifications('pickup.status_changed', { pickupCode: 'AK-1', toStatus: 'ON_THE_WAY' })).toEqual([]);
  });

  it('formats dates without timezone drift', () => {
    expect(formatScheduledDate('2026-01-01')).toBe('1 Jan 2026');
  });
});

describe('PushService', () => {
  let deviceModel: any;
  let config: any;

  const build = (env: Record<string, string> = {}) => {
    config = { get: vi.fn((k: string) => env[k]) };
    return new PushService(deviceModel, config);
  };

  beforeEach(() => {
    sendEachForMulticast.mockReset();
    deviceModel = {
      findOneAndUpdate: vi.fn(async () => ({})),
      deleteOne: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({})),
      find: vi.fn(() => ({ select: vi.fn(async () => [{ token: 't1' }, { token: 't2' }]) })),
    };
  });

  it('registers a token by upsert so a re-login on the same phone takes it over', async () => {
    await build().registerToken(OID(5), { token: 'abc', platform: 'ANDROID' as any });
    expect(deviceModel.findOneAndUpdate).toHaveBeenCalledWith(
      { token: 'abc' },
      expect.objectContaining({ $set: expect.objectContaining({ userId: OID(5) }) }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('only unregisters a token owned by the caller', async () => {
    await build().unregisterToken(OID(5), 'abc');
    expect(deviceModel.deleteOne).toHaveBeenCalledWith({ token: 'abc', userId: OID(5) });
  });

  it('is a no-op (no throw, no DB read) when Firebase is not configured', async () => {
    await build().sendToUser(OID(5), { title: 'a', body: 'b' });
    expect(deviceModel.find).not.toHaveBeenCalled();
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('sends to every device with stringified data and prunes dead tokens', async () => {
    sendEachForMulticast.mockResolvedValue({
      failureCount: 1,
      responses: [{ success: true }, { success: false, error: { code: 'messaging/registration-token-not-registered' } }],
    });
    const svc = build({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'x' }) });
    await svc.sendToUser(OID(5), { title: 'T', body: 'B', data: { pickupId: OID(1), n: 3, skip: undefined } });

    const arg = sendEachForMulticast.mock.calls[0][0];
    expect(arg.tokens).toEqual(['t1', 't2']);
    expect(arg.data).toEqual({ pickupId: OID(1), n: '3' });
    expect(arg.android.notification.channelId).toBe('pickup_updates');
    expect(deviceModel.deleteMany).toHaveBeenCalledWith({ token: { $in: ['t2'] } });
  });

  it('swallows FCM errors so callers never fail because of push', async () => {
    sendEachForMulticast.mockRejectedValue(new Error('network down'));
    const svc = build({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ project_id: 'x' }) });
    await expect(svc.sendToUser(OID(5), { title: 'T', body: 'B' })).resolves.toBeUndefined();
  });
});

describe('NotificationsService push hook', () => {
  it('stores, emits to sockets, then pushes with the notification id', async () => {
    const created = { _id: { toString: () => 'nid' }, type: 'PICKUP_ARRIVED', title: 'T', body: 'B', data: {}, createdAt: new Date() };
    const model: any = { create: vi.fn(async () => created) };
    const gateway: any = { emitToUser: vi.fn() };
    const push: any = { sendToUser: vi.fn(async () => undefined) };
    const svc = new NotificationsService(model, gateway, push);

    await svc.notify({ userId: OID(2), type: 'PICKUP_ARRIVED' as any, title: 'T', body: 'B', data: { pickupId: 'p' } });

    expect(gateway.emitToUser).toHaveBeenCalledWith(OID(2), 'notification.new', expect.any(Object));
    expect(push.sendToUser).toHaveBeenCalledWith(OID(2), {
      title: 'T',
      body: 'B',
      data: { pickupId: 'p', notificationId: 'nid' },
    });
  });
});

describe('OutboxService customer notifications', () => {
  const build = (pickup: any = null) => {
    const notify = vi.fn(async () => ({}));
    const service = new OutboxService(
      {} as any,
      { emitToPickup: vi.fn(), emitToAdminDashboard: vi.fn(), emitToUser: vi.fn(), emitToEmployee: vi.fn() } as any,
      { findById: vi.fn(async () => pickup) } as any,
      { findById: vi.fn(async () => null) } as any,
      { notify } as any,
    );
    return { service, notify };
  };

  it('notifies the customer once when a picker is assigned, with the picker name', async () => {
    const { service, notify } = build({ assignment: { employeeName: 'Ravi' } });
    await (service as any).dispatchEvent('pickup.status_changed', {
      pickupId: OID(1), pickupCode: 'AK-1', customerId: OID(2), toStatus: 'ASSIGNED',
    });
    const customerCalls = notify.mock.calls.filter((c: any) => c[0].userId === OID(2));
    expect(customerCalls).toHaveLength(1);
    expect(customerCalls[0][0].body).toContain('Ravi');
  });

  it('does not double-notify on the separate pickup.assigned event', async () => {
    const { service, notify } = build();
    await (service as any).dispatchEvent('pickup.assigned', { pickupId: OID(1), customerId: OID(2), employeeUserId: OID(3) });
    expect(notify).not.toHaveBeenCalled();
  });

  it('sends the postponed notification for an admin reschedule', async () => {
    const { service, notify } = build();
    await (service as any).dispatchEvent('pickup.status_changed', {
      pickupId: OID(1), pickupCode: 'AK-1', customerId: OID(2), action: 'RESCHEDULED', actor: 'ADMIN',
      scheduledDate: '2026-11-05', reason: 'Heavy crowd',
    });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ userId: OID(2), type: 'PICKUP_POSTPONED' }));
  });

  it('a failing notification never fails the outbox event', async () => {
    const { service, notify } = build();
    notify.mockRejectedValue(new Error('boom'));
    await expect(
      (service as any).dispatchEvent('pickup.status_changed', { pickupId: OID(1), customerId: OID(2), toStatus: 'ON_THE_WAY' }),
    ).resolves.toBeUndefined();
  });
});
