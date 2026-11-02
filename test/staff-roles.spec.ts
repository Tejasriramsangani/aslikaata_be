import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from '../src/common/guards/roles.guard.js';
import { Roles, UserRole } from '../src/common/decorators/roles.decorator.js';
import { StaffAccess, StaffRole, ALL_STAFF } from '../src/common/decorators/staff-access.decorator.js';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard.js';
import { OperationsController } from '../src/modules/operations/operations.controller.js';
import { MarketRatesController } from '../src/modules/market-rates/market-rates.controller.js';
import { AdminUsersController } from '../src/modules/identity/admin-users.controller.js';
import { AdminRoutingController } from '../src/modules/routing/controllers/admin-routing.controller.js';
import { PickupsController } from '../src/modules/pickups/pickups.controller.js';

const guard = new RolesGuard(new Reflector());

function ctx(controller: any, handler: string, user: any, method = 'GET') {
  return {
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
  } as any;
}
const staff = (staffRole?: string) => ({ userId: 'u1', roles: [UserRole.ADMIN], staffRole });
const can = (c: any, h: string, role: string | undefined, method = 'GET') => {
  try {
    return guard.canActivate(ctx(c, h, staff(role), method));
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
};

describe('Staff role permissions (RolesGuard + @StaffAccess)', () => {
  it('rejects an ADMIN user that has no staff role at all', () => {
    expect(can(OperationsController, 'getFuelLogs', undefined)).toBe(false);
    expect(can(AdminUsersController, 'getAdminUsers', undefined)).toBe(false);
  });

  it('SUPER_ADMIN can use every admin route', () => {
    expect(can(AdminUsersController, 'getAdminUsers', 'SUPER_ADMIN')).toBe(true);
    expect(can(MarketRatesController, 'update', 'SUPER_ADMIN', 'PATCH')).toBe(true);
    expect(can(OperationsController, 'createInwardVoucher', 'SUPER_ADMIN', 'POST')).toBe(true);
  });

  it('routes without @StaffAccess are Super Admin only (user management, market rates)', () => {
    for (const role of ['YARD_MANAGER', 'DISPATCHER', 'ACCOUNTANT']) {
      expect(can(AdminUsersController, 'getAdminUsers', role)).toBe(false);
      expect(can(AdminUsersController, 'createAdminUser', role, 'POST')).toBe(false);
      expect(can(MarketRatesController, 'list', role)).toBe(false);
      expect(can(MarketRatesController, 'enable', role, 'POST')).toBe(false);
    }
  });

  it('Yard Manager: runs the yard (inward / outward / stock) but not dispatch, fleet or cash', () => {
    expect(can(OperationsController, 'getInwardVouchers', 'YARD_MANAGER')).toBe(true);
    expect(can(OperationsController, 'createInwardVoucher', 'YARD_MANAGER', 'POST')).toBe(true);
    expect(can(OperationsController, 'createOutwardDispatch', 'YARD_MANAGER', 'POST')).toBe(true);
    expect(can(OperationsController, 'createFuelLog', 'YARD_MANAGER', 'POST')).toBe(false);
    expect(can(OperationsController, 'issueCashFloat', 'YARD_MANAGER', 'POST')).toBe(false);
    expect(can(PickupsController, 'assignPickup', 'YARD_MANAGER', 'POST')).toBe(false);
  });

  it('Dispatcher: assigns pickups and manages fleet/routes but cannot post inward vouchers or issue cash', () => {
    expect(can(PickupsController, 'assignPickup', 'DISPATCHER', 'POST')).toBe(true);
    expect(can(OperationsController, 'createFuelLog', 'DISPATCHER', 'POST')).toBe(true);
    expect(can(AdminRoutingController, 'listDivisions', 'DISPATCHER')).toBe(true);
    expect(can(OperationsController, 'createInwardVoucher', 'DISPATCHER', 'POST')).toBe(false);
    expect(can(OperationsController, 'issueCashFloat', 'DISPATCHER', 'POST')).toBe(false);
  });

  it('Accountant: issues/settles cash floats and reads financials but cannot assign pickups or edit the fleet', () => {
    expect(can(OperationsController, 'issueCashFloat', 'ACCOUNTANT', 'POST')).toBe(true);
    expect(can(OperationsController, 'getUnitEconomicsAndPnL', 'ACCOUNTANT')).toBe(true);
    expect(can(OperationsController, 'getInwardVouchers', 'ACCOUNTANT')).toBe(true);
    expect(can(OperationsController, 'createInwardVoucher', 'ACCOUNTANT', 'POST')).toBe(false);
    expect(can(PickupsController, 'assignPickup', 'ACCOUNTANT', 'POST')).toBe(false);
    expect(can(AdminRoutingController, 'listDivisions', 'ACCOUNTANT')).toBe(true);
  });

  it('every staff role can read the shared navigation data (divisions, pickups)', () => {
    for (const role of ALL_STAFF) {
      expect(can(AdminRoutingController, 'listDivisions', role)).toBe(true);
      expect(can(PickupsController, 'listAdminPickups', role)).toBe(true);
    }
  });

  it('read and write rules are separate', () => {
    class Demo {
      @Roles(UserRole.ADMIN)
      @StaffAccess({ read: [StaffRole.ACCOUNTANT] })
      list() {}
    }
    expect(can(Demo, 'list', 'ACCOUNTANT', 'GET')).toBe(true);
    expect(can(Demo, 'list', 'ACCOUNTANT', 'POST')).toBe(false);
  });

  it('users holding another required role (e.g. EMPLOYEE) are not subject to the staff check', () => {
    class Mixed {
      @Roles(UserRole.ADMIN, UserRole.EMPLOYEE)
      go() {}
    }
    const employee = { userId: 'e1', roles: [UserRole.EMPLOYEE] };
    expect(guard.canActivate(ctx(Mixed, 'go', employee))).toBe(true);
  });

  it('JwtAuthGuard no longer accepts the old demo_jwt_* bearer tokens', async () => {
    const jwtGuard = new JwtAuthGuard(new Reflector());
    const request: any = { headers: { authorization: 'Bearer demo_jwt_super_admin' } };
    const context: any = {
      getHandler: () => () => {},
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    };
    let allowed: unknown;
    try {
      allowed = await jwtGuard.canActivate(context);
    } catch {
      allowed = false; // passport rejects the unknown token
    }
    expect(allowed).not.toBe(true);
    expect(request.user).toBeUndefined();
  });
});
