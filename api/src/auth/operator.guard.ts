import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { UserRole } from '@raid-ledger/contract';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  member: 1,
  operator: 2,
  admin: 3,
};

interface RequestWithUser {
  user?: { id: number; username: string; role: UserRole };
}

/**
 * Guard that restricts access to operator or admin users.
 * Allows both operator and admin roles (role hierarchy).
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      return false;
    }

    const userLevel = ROLE_HIERARCHY[user.role] ?? 0;
    if (userLevel < ROLE_HIERARCHY.operator) {
      throw new ForbiddenException('Operator access required');
    }

    return true;
  }
}
