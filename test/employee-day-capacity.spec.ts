import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SequenceService } from '../src/common/database/sequence.service.js';
import { EmployeesService } from '../src/modules/employees/employees.service.js';
import { PickupsService } from '../src/modules/pickups/pickups.service.js';
import { PickupStatus } from '../src/modules/pickups/schemas/pickup-status.enum.js';
import { maxPickupsPerEmployeePerDay } from '../src/common/utils/capacity.util.js';

const OID = (n: number) => n.toString(16).padStart(24, '0');

describe('Daily pickup limit per employee', () => {
  it('defaults to 3 and can be set from the environment', () => {
    const saved = process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY;
    try {
      delete process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY;
      expect(maxPickupsPerEmployeePerDay()).toBe(3);
      process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY = '5';
      expect(maxPickupsPerEmployeePerDay()).toBe(5);
      process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY = 'abc';
      expect(maxPickupsPerEmployeePerDay()).toBe(3);
    } finally {
      if (saved === undefined) delete process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY;
      else process.env.MAX_PICKUPS_PER_EMPLOYEE_PER_DAY = saved;
    }
  });

  it('admin employee list reports how many jobs each employee has on each day', async () => {
    const profile = {
      _id: OID(101),
      userId: OID(1),
      employeeCode: 'EMP-1',
      fullName: 'Picker 1',
      toObject() {
        return { _id: this._id, userId: this.userId, employeeCode: this.employeeCode, fullName: this.fullName };
      },
    };
    const pickups = [
      { assignment: { employeeProfileId: OID(101) }, scheduledDate: '2026-11-05' },
      { assignment: { employeeProfileId: OID(101) }, scheduledDate: '2026-11-05' },
      { assignment: { employeeProfileId: OID(101) }, scheduledDate: '2026-11-05' },
      { assignment: { employeeProfileId: OID(101) }, scheduledDate: '2026-11-06' },
    ];
    const service = new EmployeesService(
      { find: vi.fn(() => ({ sort: vi.fn(async () => [profile]) })) } as any,
      {} as any,
      { find: vi.fn(() => ({ select: vi.fn(async () => [{ _id: OID(1), mobile: '9000000001' }]) })) } as any,
      {} as any,
      new SequenceService({} as any),
      undefined,
      { find: vi.fn(() => ({ select: vi.fn(() => ({ lean: vi.fn(async () => pickups) })) })) } as any,
      { distinct: vi.fn(async () => [OID(1)]) } as any,
    );

    const [emp] = await service.listAllEmployees('APPROVED');
    expect(emp.jobsByDate).toEqual({ '2026-11-05': 3, '2026-11-06': 1 });
    expect(emp.dailyLimit).toBe(3);
  });

  function buildAssign(alreadyThatDay: number) {
    const pickup: any = {
      _id: OID(50),
      pickupCode: 'AK-TEST',
      scheduledDate: '2026-11-05',
      status: PickupStatus.SCHEDULED,
      customerId: OID(9),
    };
    const countDocuments = vi.fn(async () => alreadyThatDay);
    const transition = vi.fn(async ({ pickup: p }: any) => p);
    const service = new PickupsService(
      { findById: vi.fn(async () => pickup), countDocuments } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        findById: vi.fn(async () => ({
          _id: OID(101),
          userId: OID(1),
          employeeCode: 'EMP-1',
          fullName: 'Ramesh',
          status: 'APPROVED',
        })),
      } as any,
      { find: vi.fn(async () => []) } as any,
      {} as any,
      { transition } as any,
      {} as any,
    );
    return { service, countDocuments, transition };
  }

  it('refuses a 4th pickup for the same day, counting only that employee on that date', async () => {
    const { service, countDocuments, transition } = buildAssign(3);
    await expect(
      service.assignPickup(OID(50), OID(8), { employeeProfileId: OID(101), vehicleType: 'BIKE', vehicleNumber: 'AP1' } as any),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.assignPickup(OID(50), OID(8), { employeeProfileId: OID(101), vehicleType: 'BIKE', vehicleNumber: 'AP1' } as any),
    ).rejects.toThrow(/already has 3 pickups on 2026-11-05/);

    const filter = (countDocuments.mock.calls[0] as any[])[0];
    expect(filter.scheduledDate).toBe('2026-11-05');
    expect(filter['assignment.employeeProfileId']).toBe(OID(101));
    expect(filter._id).toEqual({ $ne: OID(50) });
    expect(filter.status.$in).not.toContain(PickupStatus.CANCELLED);
    expect(transition).not.toHaveBeenCalled();
  });

  it('allows the 3rd pickup of the day, and any pickup on a day with fewer than 3', async () => {
    for (const already of [0, 1, 2]) {
      const { service, transition } = buildAssign(already);
      await service.assignPickup(OID(50), OID(8), {
        employeeProfileId: OID(101),
        vehicleType: 'BIKE',
        vehicleNumber: 'AP1',
      } as any);
      expect(transition).toHaveBeenCalledTimes(1);
    }
  });
});
