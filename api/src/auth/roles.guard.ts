import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import type { UserRole } from '@raid-ledger/contract';
import { ROLES_KEY } from './roles.decorator';

/**
 * Role hierarchy: admin (3) > operator (2) > member (1)
 * A higher-level role always satisfies a lower-level requirement.
 */
const ROLE_HIERARCHY: Record<UserRole, number> = {
  member: 1,
  operator: 2,
  admin: 3,
};

interface RequestWithUser {
  user?: { id: number; username: string; role: UserRole };
}

/**
 * Guard that checks user role against the required roles.
 * Uses role hierarchy: if any required role is met or exceeded, access is granted.
 *
 * Example: @Roles('operator') allows operator and admin.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @Roles() decorator — allow all authenticated users
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      return false;
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;

    // User passes if their role level is >= any of the required roles
    const hasRole = requiredRoles.some(
      (role) => userLevel >= ROLE_HIERARCHY[role],
    );

    if (!hasRole) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
