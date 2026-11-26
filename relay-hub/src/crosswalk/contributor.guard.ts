import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { HubAuthedRequest } from '../auth/bearer.guard';
import { hubError } from '../common/hub-errors';

/**
 * L1 (ROK-1674): only an approved, contributor-tier instance may write.
 * Runs after {@link HubBearerGuard}; anything else (a pending reader, a
 * missing instance) is 403 `not_contributor` before the body is read.
 */
@Injectable()
export class ContributorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const auth = ctx.switchToHttp().getRequest<HubAuthedRequest>().hubInstance;
    if (auth?.status === 'approved' && auth.trustTier === 'contributor') {
      return true;
    }
    throw hubError(403, 'not_contributor');
  }
}
