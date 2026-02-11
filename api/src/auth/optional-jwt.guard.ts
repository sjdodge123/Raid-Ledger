import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Optional JWT guard (ROK-213).
 * Extracts user from JWT if present, but does NOT reject unauthenticated requests.
 * Sets req.user = null when no valid token is provided.
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(_err: unknown, user: TUser | false): TUser | null {
    // Return the user if JWT was valid, otherwise null (no 401)
    return user || null;
  }

  canActivate(context: ExecutionContext) {
    // Still run passport strategy to extract user if token present
    return super.canActivate(context);
  }
}
