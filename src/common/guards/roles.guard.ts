import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator.js';
import {
  STAFF_ACCESS_KEY,
  StaffAccessRule,
  StaffRole,
} from '../decorators/staff-access.decorator.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const { user } = request;
    if (!user || !user.roles) {
      throw new ForbiddenException('Access denied: insufficient permissions');
    }

    const hasRole = requiredRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      throw new ForbiddenException('Access denied: role not permitted for this endpoint');
    }

    // Admin-panel routes: a second check on the staff role (Yard Manager, Dispatcher, ...).
    // Users that also hold another required role (e.g. EMPLOYEE) are not panel staff here.
    const passesViaAdminOnly =
      requiredRoles.includes(UserRole.ADMIN) &&
      !requiredRoles.some((r) => r !== UserRole.ADMIN && user.roles.includes(r));
    if (!passesViaAdminOnly) {
      return true;
    }

    const staffRole: string | undefined = user.staffRole;
    if (!staffRole) {
      throw new ForbiddenException('Access denied: no staff role is assigned to this account');
    }
    if (staffRole === StaffRole.SUPER_ADMIN) {
      return true;
    }

    const rule = this.reflector.getAllAndOverride<StaffAccessRule | undefined>(STAFF_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const isRead = READ_METHODS.has(String(request.method || 'GET').toUpperCase());
    const allowed = (isRead ? rule?.read : rule?.write) ?? [];
    if (!allowed.includes(staffRole as StaffRole)) {
      throw new ForbiddenException(
        `Access denied: the ${staffRole.replace(/_/g, ' ').toLowerCase()} role cannot ${
          isRead ? 'view' : 'change'
        } this resource`,
      );
    }
    return true;
  }
}
