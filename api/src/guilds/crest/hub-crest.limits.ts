import { HttpException, HttpStatus } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  GUILD_CREST_UPLOAD_MAX_BYTES,
  type GuildCrestUploadErrorCode,
} from '@raid-ledger/contract';
import { INCR_FIXED_WINDOW_LUA } from '../../common/redis-lease';

/** ROK-1814 — multer limits: memory storage, one `file` part, 1 MiB cap. */
export function crestMulterOptions(): {
  limits: { fileSize: number; files: number; fields: number; parts: number };
} {
  return {
    limits: {
      fileSize: GUILD_CREST_UPLOAD_MAX_BYTES,
      files: 1,
      fields: 1,
      parts: 2,
    },
  };
}

/** A coded error body the web maps by `code`, never by message text. */
export function crestUploadError(
  status: HttpStatus,
  code: GuildCrestUploadErrorCode,
  message: string,
): HttpException {
  return new HttpException({ statusCode: status, code, message }, status);
}

export const CREST_UPLOAD_WINDOW_SECONDS = 60 * 60;
const DEFAULT_CREST_UPLOADS_PER_HOUR = 10;

/**
 * Per-user hourly allowance. An explicit `GUILD_CREST_UPLOAD_PER_HOUR`
 * wins (specs set it low); otherwise `THROTTLE_DISABLED=true` lifts it;
 * otherwise 10.
 */
export function crestUploadsPerHour(): number | null {
  const raw = process.env.GUILD_CREST_UPLOAD_PER_HOUR;
  const n = Number(raw);
  if (raw !== undefined && Number.isInteger(n) && n > 0) return n;
  if (process.env.THROTTLE_DISABLED === 'true') return null;
  return DEFAULT_CREST_UPLOADS_PER_HOUR;
}

export const crestRateKey = (userId: number): string =>
  `guild-crest-upload:${userId}`;

/**
 * Fixed hourly window across every hub (INCR + EXPIRE as one Lua script,
 * so a key never loses its TTL). Counted BEFORE the encode, so a rejected
 * file still costs a slot. 429 `rate_limited` past the limit.
 */
export async function checkCrestUploadRate(
  redis: Redis,
  userId: number,
): Promise<void> {
  const limit = crestUploadsPerHour();
  if (limit === null) return;
  const count = Number(
    await redis.eval(
      INCR_FIXED_WINDOW_LUA,
      1,
      crestRateKey(userId),
      CREST_UPLOAD_WINDOW_SECONDS,
    ),
  );
  if (count > limit) {
    throw crestUploadError(
      HttpStatus.TOO_MANY_REQUESTS,
      'rate_limited',
      "You've changed the crest a lot — try again later.",
    );
  }
}
