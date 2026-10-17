import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { UserRole } from '@raid-ledger/contract';

interface RequestWithUser {
  user?: { id: number; username: string; role: UserRole };
}

/**
 * Guard that restricts access to admin-only endpoints.
 * Preserved for backward compatibility — new code should use
 * @Roles('admin') with RolesGuard instead.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      // User not authenticated or JwtGuard not run before this
      return false;
    }

    if (user.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
