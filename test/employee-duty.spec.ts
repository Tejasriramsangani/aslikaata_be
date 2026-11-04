import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SequenceService } from '../src/common/database/sequence.service.js';
import { EmployeesService } from '../src/modules/employees/employees.service.js';
import { EmployeeStatus } from '../src/modules/employees/schemas/employee-profile.schema.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');

function build(profile: any) {
  const profileModel: any = {
    findOne: vi.fn(async () => profile),
    find: vi.fn(() => ({ sort: vi.fn(async () => (profile ? [profile] : [])) })),
  };
  const service = new EmployeesService(
    profileModel,
    {} as any,
    { find: vi.fn(() => ({ select: vi.fn(async () => [{ _id: OID(1), mobile: '9000000001' }]) })) } as any,
    {} as any,
    new SequenceService({} as any),
    undefined,
    { find: vi.fn(() => ({ select: vi.fn(() => ({ lean: vi.fn(async () => []) })) })) } as any,
    { distinct: vi.fn(async () => [OID(1)]) } as any,
  );
  return { service, profileModel };
}

const profileDoc = (extra: any = {}) => ({
  _id: OID(101),
  userId: OID(1),
  employeeCode: 'EMP-1',
  fullName: 'Ramesh',
  status: EmployeeStatus.APPROVED,
  onDuty: false,
  dutyChangedAt: null,
  save: vi.fn(async () => undefined),
  toObject() {
    return { _id: this._id, userId: this.userId, employeeCode: this.employeeCode, onDuty: this.onDuty };
  },
  ...extra,
});

describe('Duty switch (the Duty ON / OFF button in the employee app)', () => {
  it('switches duty on and off and remembers when', async () => {
    const profile = profileDoc();
    const { service } = build(profile);

    const on = await service.setDuty(OID(1), true);
    expect(on.onDuty).toBe(true);
    expect(profile.onDuty).toBe(true);
    expect(on.dutyChangedAt).toBeInstanceOf(Date);
    expect(profile.save).toHaveBeenCalledTimes(1);

    const off = await service.setDuty(OID(1), false);
    expect(off.onDuty).toBe(false);
    expect(profile.onDuty).toBe(false);
  });

  it('only an approved employee can go on duty, but anyone can go off', async () => {
    const pending = profileDoc({ status: EmployeeStatus.PENDING_REVIEW, onDuty: true });
    const { service } = build(pending);
    await expect(service.setDuty(OID(1), true)).rejects.toThrow(BadRequestException);
    await expect(service.setDuty(OID(1), false)).resolves.toMatchObject({ onDuty: false });
  });

  it('fails clearly when there is no employee profile', async () => {
    const { service } = build(null);
    await expect(service.setDuty(OID(1), true)).rejects.toThrow(NotFoundException);
  });

  it('the admin list says who is on duty (employees start off duty)', async () => {
    const onDuty = profileDoc({ onDuty: true });
    const [onEmp] = await build(onDuty).service.listAllEmployees('APPROVED');
    expect(onEmp).toMatchObject({ isLoggedIn: true, onDuty: true });

    const offDuty = profileDoc({ onDuty: undefined });
    const [offEmp] = await build(offDuty).service.listAllEmployees('APPROVED');
    expect(offEmp.onDuty).toBe(false);
  });
});
