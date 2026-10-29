import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  envLimit,
  rateLimited,
} from '../../../common/rate-limit/env-limit.helpers';
import type { ValheimLinkRequest } from './valheim-link-request';
import { ValheimLinkRateLimiter } from './valheim-link-rate-limiter';

/** ROK-1955: moved to the shared env-limit helpers; re-exported unchanged. */
export { envLimit, rateLimited };

export type ValheimLinkBucket = 'messages' | 'blobs';
export const VALHEIM_LINK_BUCKET_KEY = 'valheimLinkBucket';
/** Pick the per-server budget a route draws from (default `messages`). */
export const ValheimLinkRateBucket = (bucket: ValheimLinkBucket) =>
  SetMetadata(VALHEIM_LINK_BUCKET_KEY, bucket);

export const WINDOW_MS = 60_000;
const DEFAULTS: Record<ValheimLinkBucket, number> = { messages: 60, blobs: 20 };
const ENV: Record<ValheimLinkBucket, string> = {
  messages: 'VALHEIM_LINK_RATE_MESSAGES_PER_MIN',
  blobs: 'VALHEIM_LINK_RATE_BLOBS_PER_MIN',
};

/** Per-minute limit for a per-server bucket (see `envLimit`). */
export function bucketLimit(bucket: ValheimLinkBucket): number | null {
  return envLimit(ENV[bucket], DEFAULTS[bucket]);
}

/** Pre-auth failed attempts per minute per IP (`VALHEIM_LINK_RATE_AUTH_PER_MIN`, 30). */
export function authFailureLimit(): number | null {
  return envLimit('VALHEIM_LINK_RATE_AUTH_PER_MIN', 30);
}

/**
 * ROK-1833 per-server rate limit, keyed `valheim-link:<bucket>:<serverId>`
 * (not IP — servers share NATs). Runs AFTER `ValheimLinkBearerGuard`.
 * 429 `rate_limited` with `Retry-After`.
 */
@Injectable()
export class ValheimLinkRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: ValheimLinkRateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<ValheimLinkRequest>();
    const auth = req.valheimLink;
    if (!auth) throw new InternalServerErrorException();
    const bucket =
      this.reflector.getAllAndOverride<ValheimLinkBucket | undefined>(
        VALHEIM_LINK_BUCKET_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'messages';
    const limit = bucketLimit(bucket);
    if (limit === null) return true;
    const key = `valheim-link:${bucket}:${auth.pelicanServerId}`;
    const hit = this.limiter.hit(key, limit, WINDOW_MS);
    if (hit.allowed) return true;
    http
      .getResponse<{ setHeader(n: string, v: string): void }>()
      .setHeader('Retry-After', String(hit.retryAfterSec));
    throw rateLimited('Too many requests for this server');
  }
}
