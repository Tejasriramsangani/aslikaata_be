import { SetMetadata } from '@nestjs/common';

/**
 * Staff roles of admin-panel users (stored on AdminCredential.role).
 * `UserRole.ADMIN` only says "is panel staff"; this says *which* staff member.
 */
export enum StaffRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  YARD_MANAGER = 'YARD_MANAGER',
  DISPATCHER = 'DISPATCHER',
  ACCOUNTANT = 'ACCOUNTANT',
}

export const ALL_STAFF: StaffRole[] = [
  StaffRole.SUPER_ADMIN,
  StaffRole.YARD_MANAGER,
  StaffRole.DISPATCHER,
  StaffRole.ACCOUNTANT,
];

export interface StaffAccessRule {
  /** Staff roles allowed on GET / HEAD / OPTIONS. */
  read?: StaffRole[];
  /** Staff roles allowed on POST / PUT / PATCH / DELETE. */
  write?: StaffRole[];
}

export const STAFF_ACCESS_KEY = 'staffAccess';

/**
 * Grants extra staff roles on an `@Roles(UserRole.ADMIN)` route (handler or class level;
 * the handler wins). SUPER_ADMIN is always allowed. A route with no `@StaffAccess`
 * is therefore Super Admin only.
 */
export const StaffAccess = (rule: StaffAccessRule) => SetMetadata(STAFF_ACCESS_KEY, rule);

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (Object.values(StaffRole) as string[]).includes(value);
}
