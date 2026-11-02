import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { PickerRequestsService } from '../src/modules/picker-requests/picker-requests.service.js';
import { OutboxService } from '../src/modules/outbox/outbox.service.js';

const OID = (n: number) => `64b0f0f0f0f0f0f0f0f0f${String(n).padStart(3, '0')}`;

const validDto: any = {
  fullName: 'Ravi Teja',
  mobile: '9876543210',
  address: { line1: '12-3-45, Gandhi Street', area: 'Benz Circle', city: 'Vijayawada', pincode: '520010' },
  workType: 'FIELD_COLLECTOR',
  vehicleType: 'BIKE',
  availability: 'FULL_TIME',
};

function setup() {
  const state: any = { requestDoc: null, user: null, profile: null, pending: null };
  const requestModel: any = {
    findOne: vi.fn((q: any) => {
      const result = q.status === 'PENDING' ? state.pending : state.requestDoc;
      return Object.assign(Promise.resolve(result), { sort: vi.fn(async () => result) });
    }),
    create: vi.fn(async (doc: any) => ({ ...doc, _id: OID(50), status: 'PENDING', save: vi.fn() })),
    findById: vi.fn(async () => state.requestDoc),
    countDocuments: vi.fn(async () => 3),
  };
  const userModel: any = {
    findOne: vi.fn(async () => state.user),
    create: vi.fn(async (doc: any) => ({ ...doc, _id: OID(60), save: vi.fn() })),
  };
  const profileModel: any = {
    findOne: vi.fn(async () => state.profile),
    create: vi.fn(async (doc: any) => ({ ...doc, _id: OID(70) })),
  };
  const auditLogModel: any = { create: vi.fn(async () => ({})) };
  const adminModel: any = {
    findOne: vi.fn(() => ({ select: () => ({ lean: async () => ({ name: 'Ramesh Varma' }) }) })),
  };
  const sequence: any = {
    getNextSequence: vi.fn(async () => 10042),
    generateEmployeeCode: vi.fn(async () => 'EMP-205'),
  };
  const notifications: any = { notify: vi.fn(async () => ({})) };
  const gateway: any = { emitToAdminQueue: vi.fn() };
  const sms: any = { sendText: vi.fn(async () => true) };

  const service = new PickerRequestsService(
    requestModel,
    userModel,
    profileModel,
    auditLogModel,
    adminModel,
    sequence,
    notifications,
    gateway,
    sms,
  );
  return { service, state, requestModel, userModel, profileModel, auditLogModel, notifications, gateway, sms };
}

const pendingRequest = (over: any = {}) => ({
  _id: OID(50),
  requestCode: 'PR-10042',
  fullName: 'Ravi Teja',
  mobile: '9876543210',
  address: validDto.address,
  vehicleType: 'BIKE',
  vehicleNumber: null,
  status: 'PENDING',
  save: vi.fn(async () => undefined),
  ...over,
});

describe('PickerRequestsService – submitting a request', () => {
  it('stores the request with a PR- code and alerts the admin panel', async () => {
    const t = setup();
    const res = await t.service.submit(validDto, '1.1.1.1');

    expect(res.requestCode).toBe('PR-10042');
    expect(t.requestModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ mobile: '9876543210', address: expect.objectContaining({ pincode: '520010', state: 'Andhra Pradesh' }) }),
    );
    expect(t.gateway.emitToAdminQueue).toHaveBeenCalledWith('picker_request.created', expect.objectContaining({ requestCode: 'PR-10042' }));
  });

  it('refuses a number that already has a field account', async () => {
    const t = setup();
    t.state.user = { roles: ['EMPLOYEE'] };
    await expect(t.service.submit(validDto)).rejects.toThrow(ConflictException);
    expect(t.requestModel.create).not.toHaveBeenCalled();
  });

  it('refuses a second request while one is still pending', async () => {
    const t = setup();
    t.state.pending = pendingRequest();
    await expect(t.service.submit(validDto)).rejects.toThrow(ConflictException);
  });

  it('allows a customer number to apply (they only gain the employee role on approval)', async () => {
    const t = setup();
    t.state.user = { roles: ['CUSTOMER'] };
    await expect(t.service.submit(validDto)).resolves.toBeDefined();
  });

  it('rate-limits the public endpoint per IP', async () => {
    const t = setup();
    for (let i = 0; i < 5; i++) await t.service.submit(validDto, '9.9.9.9');
    const err = await t.service.submit(validDto, '9.9.9.9').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
  });
});

describe('PickerRequestsService – approving', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
    t.state.requestDoc = pendingRequest();
  });

  it('creates the login account + approved profile, notifies and texts the applicant', async () => {
    const res = await t.service.approve(OID(50), { userId: OID(9) });

    expect(t.userModel.create).toHaveBeenCalledWith(expect.objectContaining({ mobile: '9876543210', roles: ['EMPLOYEE'], status: 'ACTIVE' }));
    expect(t.profileModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OID(60), employeeCode: 'EMP-205', fullName: 'Ravi Teja', status: 'APPROVED', address: validDto.address }),
    );
    expect(t.state.requestDoc.status).toBe('APPROVED');
    expect(t.state.requestDoc.reviewedByName).toBe('Ramesh Varma');
    expect(res.employeeCode).toBe('EMP-205');

    expect(t.notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OID(60), type: 'ACCOUNT_APPROVED', body: expect.stringContaining('approved your request') }),
    );
    expect(t.sms.sendText).toHaveBeenCalledWith('9876543210', expect.stringContaining('approved your request'));
    expect(t.auditLogModel.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'APPROVE_PICKER_REQUEST' }));
  });

  it('adds the employee role to an existing customer instead of creating a duplicate user', async () => {
    const save = vi.fn();
    t.state.user = { _id: OID(61), roles: ['CUSTOMER'], status: 'ACTIVE', save };
    await t.service.approve(OID(50), { userId: OID(9) });

    expect(t.userModel.create).not.toHaveBeenCalled();
    expect(t.state.user.roles).toEqual(['CUSTOMER', 'EMPLOYEE']);
    expect(save).toHaveBeenCalled();
  });

  it('cannot approve twice', async () => {
    t.state.requestDoc = pendingRequest({ status: 'APPROVED' });
    await expect(t.service.approve(OID(50), { userId: OID(9) })).rejects.toThrow(BadRequestException);
    expect(t.userModel.create).not.toHaveBeenCalled();
  });

  it('does not override a suspended field account', async () => {
    t.state.user = { _id: OID(61), roles: ['EMPLOYEE'], status: 'ACTIVE', save: vi.fn() };
    t.state.profile = { status: 'SUSPENDED' };
    await expect(t.service.approve(OID(50), { userId: OID(9) })).rejects.toThrow(BadRequestException);
    expect(t.state.requestDoc.status).toBe('PENDING');
  });

  it('404s for an unknown or malformed id', async () => {
    await expect(t.service.approve('not-an-id', { userId: OID(9) })).rejects.toThrow(NotFoundException);
  });
});

describe('PickerRequestsService – rejecting', () => {
  it('records the reason and texts the applicant, without creating any account', async () => {
    const t = setup();
    t.state.requestDoc = pendingRequest();
    await t.service.reject(OID(50), 'Outside our service area', { userId: OID(9) });

    expect(t.state.requestDoc.status).toBe('REJECTED');
    expect(t.state.requestDoc.rejectionReason).toBe('Outside our service area');
    expect(t.userModel.create).not.toHaveBeenCalled();
    expect(t.sms.sendText).toHaveBeenCalledWith('9876543210', expect.stringContaining('Outside our service area'));
  });

  it('cannot reject a request that was already decided', async () => {
    const t = setup();
    t.state.requestDoc = pendingRequest({ status: 'REJECTED' });
    await expect(t.service.reject(OID(50), 'again', { userId: OID(9) })).rejects.toThrow(BadRequestException);
  });
});

describe('OutboxService – pickup notifications for the assigned employee', () => {
  function build(pickup: any) {
    const notify = vi.fn(async () => ({}));
    const service = new OutboxService(
      {} as any,
      { emitToPickup: vi.fn(), emitToAdminDashboard: vi.fn() } as any,
      { findById: vi.fn(async () => pickup) } as any,
      { findById: vi.fn(async () => ({ userId: OID(60) })) } as any,
      { notify } as any,
    );
    return { service, notify };
  }
  const basePickup = (over: any = {}) => ({
    _id: OID(80),
    pickupCode: 'AK-10077',
    status: 'ASSIGNED',
    scheduledDate: '2026-11-05',
    timeSlotSnapshot: { displayLabel: '10 AM - 12 PM' },
    addressSnapshot: { line1: '5-6 Main Rd', city: 'Vijayawada' },
    assignment: { employeeProfileId: OID(70) },
    ...over,
  });

  it('notifies the employee when a pickup is assigned (any assignment path)', async () => {
    const { service, notify } = build(basePickup());
    await (service as any).dispatchEvent('pickup.status_changed', { pickupId: OID(80), toStatus: 'ASSIGNED' });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OID(60),
        type: 'PICKUP_ASSIGNED',
        title: 'New pickup assigned',
        body: expect.stringContaining('AK-10077'),
        data: expect.objectContaining({ pickupId: OID(80) }),
      }),
    );
  });

  it('notifies on reschedule and cancel of an assigned pickup', async () => {
    const a = build(basePickup());
    await (a.service as any).dispatchEvent('pickup.status_changed', { pickupId: OID(80), action: 'RESCHEDULED' });
    expect(a.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'PICKUP_RESCHEDULED' }));

    const b = build(basePickup({ status: 'CANCELLED' }));
    await (b.service as any).dispatchEvent('pickup.status_changed', { pickupId: OID(80), toStatus: 'CANCELLED' });
    expect(b.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'PICKUP_CANCELLED' }));
  });

  it('stays quiet for unassigned pickups and unrelated status changes', async () => {
    const a = build(basePickup({ assignment: null }));
    await (a.service as any).dispatchEvent('pickup.status_changed', { pickupId: OID(80), toStatus: 'CANCELLED' });
    expect(a.notify).not.toHaveBeenCalled();

    const b = build(basePickup());
    await (b.service as any).dispatchEvent('pickup.status_changed', { pickupId: OID(80), toStatus: 'ON_THE_WAY' });
    expect(b.notify).not.toHaveBeenCalled();
  });
});
