/**
 * ROK-1956 D-18 — per-principal rate limits on the companion ingest + blob
 * routes, on C2's shared `CompanionDeviceRateLimiter` (distinct key prefix).
 * Device path: per device AND per user (N devices cannot multiply the cap);
 * session path: per user. Limits are env-overridable and read per call
 * (`envLimit`: `THROTTLE_DISABLED` lifts the defaults only). Keys hold ids
 * only — never a token.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { envLimit } from '../../common/rate-limit/env-limit.helpers';
import {
  hitOrThrow,
  type BudgetSpec,
  type HeaderSink,
} from '../devices/companion-device-link-budget';
import {
  CompanionDeviceRateLimiter,
  MINUTE_MS,
} from '../devices/companion-device-link.limits';
import type {
  CompanionIngestAuth,
  CompanionIngestRequest,
  CompanionIngestVia,
} from './companion-ingest-request';

export type CompanionIngestBucket = 'messages' | 'blobs';
type Scope = 'device' | 'user';

export const COMPANION_INGEST_BUCKET_KEY = 'companionIngestBucket';
/** Pick the budget a route draws from (default `messages`). */
export const CompanionIngestRateBucket = (
  bucket: CompanionIngestBucket,
): ClassDecorator & MethodDecorator =>
  SetMetadata(COMPANION_INGEST_BUCKET_KEY, bucket);

/** Q6 defaults (UNVERIFIED numbers, env-overridable), per minute. */
const DEFAULTS: Record<CompanionIngestBucket, Record<Scope, number>> = {
  messages: { device: 30, user: 60 },
  blobs: { device: 20, user: 40 },
};
const ENV: Record<CompanionIngestBucket, Record<Scope, string>> = {
  messages: {
    device: 'COMPANION_INGEST_RATE_MESSAGES_PER_DEVICE_PER_MIN',
    user: 'COMPANION_INGEST_RATE_MESSAGES_PER_USER_PER_MIN',
  },
  blobs: {
    device: 'COMPANION_INGEST_RATE_BLOBS_PER_DEVICE_PER_MIN',
    user: 'COMPANION_INGEST_RATE_BLOBS_PER_USER_PER_MIN',
  },
};

/** Per-minute limit for one bucket + scope; null = unlimited. */
export function ingestRateLimit(
  bucket: CompanionIngestBucket,
  scope: Scope,
): number | null {
  return envLimit(ENV[bucket][scope], DEFAULTS[bucket][scope]);
}

/** The caller's effective per-minute cap for `/config` (tightest applicable). */
export function callerRatePerMin(
  bucket: CompanionIngestBucket,
  via: CompanionIngestVia,
): number | null {
  const caps = [ingestRateLimit(bucket, 'user')];
  if (via === 'device') caps.push(ingestRateLimit(bucket, 'device'));
  const finite = caps.filter((c): c is number => c !== null);
  return finite.length === 0 ? null : Math.min(...finite);
}

/** The budgets one request draws from, device first. */
function budgetsFor(
  bucket: CompanionIngestBucket,
  auth: CompanionIngestAuth,
): BudgetSpec[] {
  const prefix = `companion-ingest:${bucket}`;
  const user: BudgetSpec = {
    key: `${prefix}:user:${auth.userId}`,
    limit: ingestRateLimit(bucket, 'user'),
    windowMs: MINUTE_MS,
  };
  if (auth.deviceId === null) return [user];
  const device: BudgetSpec = {
    key: `${prefix}:device:${auth.deviceId}`,
    limit: ingestRateLimit(bucket, 'device'),
    windowMs: MINUTE_MS,
  };
  return [device, user];
}

/**
 * Runs AFTER `CompanionIngestAuthGuard` and BEFORE any body read. 429
 * `rate_limited` + `Retry-After` once a budget is spent; every request counts.
 */
@Injectable()
export class CompanionIngestRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: CompanionDeviceRateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const auth = http.getRequest<CompanionIngestRequest>().companionIngest;
    if (!auth) throw new InternalServerErrorException();
    const bucket =
      this.reflector.getAllAndOverride<CompanionIngestBucket | undefined>(
        COMPANION_INGEST_BUCKET_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'messages';
    const res = http.getResponse<HeaderSink>();
    for (const spec of budgetsFor(bucket, auth)) {
      hitOrThrow(this.limiter, res, spec, 'Too many companion uploads');
    }
    return true;
  }
}
