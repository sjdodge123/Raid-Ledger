import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ingestError, type ValheimLinkRequest } from './valheim-link-request';
import { ValheimLinkRateLimiter } from './valheim-link-rate-limiter';

export type ValheimLinkBucket = 'messages' | 'blobs';
export const VALHEIM_LINK_BUCKET_KEY = 'valheimLinkBucket';
/** Pick the per-server budget a route draws from (default `messages`). */
export const ValheimLinkRateBucket = (bucket: ValheimLinkBucket) =>
  SetMetadata(VALHEIM_LINK_BUCKET_KEY, bucket);

const WINDOW_MS = 60_000;
const DEFAULTS: Record<ValheimLinkBucket, number> = { messages: 60, blobs: 20 };
const ENV: Record<ValheimLinkBucket, string> = {
  messages: 'VALHEIM_LINK_RATE_MESSAGES_PER_MIN',
  blobs: 'VALHEIM_LINK_RATE_BLOBS_PER_MIN',
};

/**
 * Per-minute limit for a bucket, read per call (integration specs set it).
 * null = unlimited: `THROTTLE_DISABLED=true` lifts the DEFAULT only — an
 * explicit env override still applies. DEMO_MODE never lifts it.
 */
export function bucketLimit(bucket: ValheimLinkBucket): number | null {
  const raw = process.env[ENV[bucket]];
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  if (process.env.THROTTLE_DISABLED === 'true') return null;
  return DEFAULTS[bucket];
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
    throw new HttpException(
      ingestError('rate_limited', 'Too many requests for this server'),
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
