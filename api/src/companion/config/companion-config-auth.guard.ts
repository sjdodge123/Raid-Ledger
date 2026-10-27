/**
 * ROK-1956 §8 — optional auth for `GET /companion/v1/config`. No
 * `Authorization` header → anonymous (nothing attached). Any header, even an
 * empty or malformed one → the D-17 `CompanionIngestAuthGuard`, whose 401 is
 * final: a present but invalid credential is never silently downgraded to
 * anonymous. Never logs the header.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { CompanionIngestAuthGuard } from '../ingest/companion-ingest-auth.guard';
import type { CompanionIngestRequest } from '../ingest/companion-ingest-request';

@Injectable()
export class CompanionConfigAuthGuard implements CanActivate {
  constructor(
    @Inject(CompanionIngestAuthGuard)
    private readonly auth: Pick<CompanionIngestAuthGuard, 'canActivate'>,
  ) {}

  /** Anonymous when no credential is present; else D-17 decides. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<CompanionIngestRequest>();
    if (req.headers['authorization'] === undefined) return true;
    return this.auth.canActivate(context);
  }
}
