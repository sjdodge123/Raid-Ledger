import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { GgMascotOptionsDto } from '@raid-ledger/contract';

/**
 * DI token for where the guild's emojis + sounds come from (the bot client
 * in prod, a fake in specs). `null` = the bot is offline.
 */
export abstract class GgMascotExpressionSource {
  abstract fetchExpressions(): Promise<GgMascotOptionsDto | null>;
}

/** Options cache TTL (spec: one Discord call per 60 s). */
export const GG_MASCOT_OPTIONS_TTL_MS = 60_000;

/**
 * Milliseconds Discord asked us to wait, when `err` is a 429 — discord.js
 * `RateLimitError.retryAfter` (ms) or a `DiscordAPIError` 429 with
 * `rawError.retry_after` (s). `null` for any other error.
 */
export function retryAfterMs(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null;
  if ('retryAfter' in err && typeof err.retryAfter === 'number')
    return err.retryAfter;
  if (!('status' in err) || err.status !== 429) return null;
  const raw = 'rawError' in err ? err.rawError : null;
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'retry_after' in raw &&
    typeof raw.retry_after === 'number'
  ) {
    return Math.ceil(raw.retry_after * 1000);
  }
  return 1000;
}

/**
 * ROK-2187 — the admin picker's emoji + sound list, fetched only when asked,
 * cached 60 s, and backed off for Discord's `retry_after` on a 429 (stale
 * cache served meanwhile; none ⇒ 429 with the wait).
 */
@Injectable()
export class GgMascotOptionsService {
  private cache: { at: number; value: GgMascotOptionsDto } | null = null;
  private blockedUntil = 0;

  constructor(private readonly source: GgMascotExpressionSource) {}

  /** Cached options; 503 while the bot is offline. */
  async getOptions(now: number = Date.now()): Promise<GgMascotOptionsDto> {
    if (this.cache && now - this.cache.at < GG_MASCOT_OPTIONS_TTL_MS)
      return this.cache.value;
    if (now < this.blockedUntil) return this.staleOrTooMany(now);
    try {
      const value = await this.source.fetchExpressions();
      if (!value)
        throw new ServiceUnavailableException('Discord bot is offline');
      this.cache = { at: now, value };
      return value;
    } catch (err) {
      const wait = retryAfterMs(err);
      if (wait === null) throw err;
      this.blockedUntil = now + wait;
      return this.staleOrTooMany(now);
    }
  }

  /** Drops the cache and any back-off (specs; a forced re-fetch). */
  invalidate(): void {
    this.cache = null;
    this.blockedUntil = 0;
  }

  private staleOrTooMany(now: number): GgMascotOptionsDto {
    if (this.cache) return this.cache.value;
    const retryAfter = Math.ceil((this.blockedUntil - now) / 1000);
    throw new HttpException(
      { message: 'Discord rate limited; retry later', retryAfter },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
