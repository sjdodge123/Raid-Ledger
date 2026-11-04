import { HttpException, HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  HUB_MEDIA_UPLOAD_MAX_BYTES,
  type HubMediaUploadErrorCode,
} from '@raid-ledger/contract';
import { INCR_FIXED_WINDOW_LUA } from '../common/redis-lease';

/**
 * ROK-1965 D4 — multer limits: memory storage, one `file` part, nothing
 * past the 9 MiB cap is buffered (busboy aborts the stream → 413).
 */
export function uploadMulterOptions() {
  return {
    limits: {
      fileSize: HUB_MEDIA_UPLOAD_MAX_BYTES,
      files: 1,
      fields: 2,
      parts: 3,
    },
  };
}

/** An error body the web maps by `code`, never by message text (§6). */
export function uploadError(
  status: HttpStatus,
  code: HubMediaUploadErrorCode,
  message: string,
): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

export const UPLOAD_WINDOW_SECONDS = 60 * 60;
const DEFAULT_UPLOADS_PER_HOUR = 20;

/**
 * A per-user hourly allowance read from `envVar`: an explicit positive
 * integer always wins (specs set it low; fleet envs can raise it); otherwise
 * `THROTTLE_DISABLED=true` (CI) lifts it (null); otherwise `fallback`.
 */
export function hourlyAllowance(
  envVar: string,
  fallback: number,
): number | null {
  const raw = process.env[envVar];
  const n = Number(raw);
  if (raw !== undefined && Number.isInteger(n) && n > 0) return n;
  if (process.env.THROTTLE_DISABLED === 'true') return null;
  return fallback;
}

/** D8 per-user hourly allowance: `HUB_MEDIA_UPLOAD_PER_HOUR`, else 20 (ruling 9). */
export function uploadsPerHour(): number | null {
  return hourlyAllowance('HUB_MEDIA_UPLOAD_PER_HOUR', DEFAULT_UPLOADS_PER_HOUR);
}

/**
 * Count one hit on `key`'s one-hour fixed window; true once the count passes
 * `limit`. `INCR` and the expiry run as ONE Lua script, so a key can never be
 * left without a TTL (a crash between two separate calls would lock the user
 * out for good).
 */
export async function overHourlyAllowance(
  redis: Redis,
  key: string,
  limit: number,
): Promise<boolean> {
  const count = Number(
    await redis.eval(INCR_FIXED_WINDOW_LUA, 1, key, UPLOAD_WINDOW_SECONDS),
  );
  return count > limit;
}

export const uploadRateKey = (userId: number): string =>
  `hub-media-upload:${userId}`;

/**
 * D8 fixed window across every hub ({@link overHourlyAllowance}). Counted
 * BEFORE the encode (by `HubMediaUploadGuard`), so a rejected file still
 * costs a slot.
 */
export async function checkUploadRate(
  redis: Redis,
  userId: number,
): Promise<void> {
  const limit = uploadsPerHour();
  if (limit === null) return;
  if (await overHourlyAllowance(redis, uploadRateKey(userId), limit)) {
    throw uploadError(
      HttpStatus.TOO_MANY_REQUESTS,
      'rate_limited',
      "You've added a lot of pictures — try again later.",
    );
  }
}
