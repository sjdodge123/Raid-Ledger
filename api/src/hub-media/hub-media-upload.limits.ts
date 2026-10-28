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
 * D8 per-user hourly allowance. An explicit `HUB_MEDIA_UPLOAD_PER_HOUR`
 * always wins (specs set it low; fleet envs can raise it); otherwise
 * `THROTTLE_DISABLED=true` (CI) lifts it; otherwise 20 (ruling 9).
 */
export function uploadsPerHour(): number | null {
  const raw = process.env.HUB_MEDIA_UPLOAD_PER_HOUR;
  const n = Number(raw);
  if (raw !== undefined && Number.isInteger(n) && n > 0) return n;
  if (process.env.THROTTLE_DISABLED === 'true') return null;
  return DEFAULT_UPLOADS_PER_HOUR;
}

export const uploadRateKey = (userId: number): string =>
  `hub-media-upload:${userId}`;

/**
 * D8 fixed window across every hub. `INCR` and the expiry run as ONE Lua
 * script, so a key can never be left without a TTL (a crash between two
 * separate calls would lock the user out for good). Counted BEFORE the
 * encode (by `HubMediaUploadGuard`), so a rejected file still costs a slot.
 */
export async function checkUploadRate(
  redis: Redis,
  userId: number,
): Promise<void> {
  const limit = uploadsPerHour();
  if (limit === null) return;
  const count = Number(
    await redis.eval(
      INCR_FIXED_WINDOW_LUA,
      1,
      uploadRateKey(userId),
      UPLOAD_WINDOW_SECONDS,
    ),
  );
  if (count > limit) {
    throw uploadError(
      HttpStatus.TOO_MANY_REQUESTS,
      'rate_limited',
      "You've added a lot of pictures — try again later.",
    );
  }
}
