import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedUser } from './types';

/**
 * ROK-1275 — write-side gate for users auto-deactivated by ROK-1260.
 *
 * Runs after `AuthGuard('jwt')` and inspects `req.user.deactivatedAt`.
 * Non-null timestamp → 403 `{ code: 'USER_DEACTIVATED' }`. Admins acting
 * via impersonation bypass the gate (`req.user.impersonatedBy` set).
 *
 * Wire as `@UseGuards(AuthGuard('jwt'), NotDeactivatedGuard)` on every
 * write endpoint that creates or modifies shared state. Self-state
 * endpoints (cancelSignup, selfUnassign, /users/me/*, /notifications/*)
 * stay open so a deactivated user can still wind down their footprint.
 */
@Injectable()
export class NotDeactivatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return false;
    if (user.impersonatedBy) return true;
    if (user.deactivatedAt) {
      throw new ForbiddenException({
        code: 'USER_DEACTIVATED',
        message: 'Account deactivated',
      });
    }
    return true;
  }
}
