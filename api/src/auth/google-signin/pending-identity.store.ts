/**
 * ROK-2371 D1(a): a sign-in identity that matched no account, parked for the
 * `/auth/first-time` choice ("I already have an account" / "Create a new
 * account").
 *
 * Redis `pending-identity:<sha256(secret)>`, 10-minute TTL. The secret lives
 * only in the httpOnly `rl_pending_identity` cookie of the browser that
 * finished the OAuth, so the record is bound to that browser. Consume is
 * atomic (GET+DEL in one MULTI) — a record is spent once.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { browserBoundCookieAttrs } from '../browser-bound-cookie.helpers';
import { readCookie } from '../link-nonce-cookie.helpers';

export const PENDING_IDENTITY_COOKIE = 'rl_pending_identity';
export const PENDING_IDENTITY_TTL_SECONDS = 600;
const KEY_PREFIX = 'pending-identity:';

export type PendingProvider = 'google' | 'discord';

export interface PendingIdentity {
  provider: PendingProvider;
  /** Google `sub` or Discord snowflake. Never shown to the browser. */
  subject: string;
  displayName: string;
  /** Google only; display-only, never a lookup key. */
  email: string | null;
  /** Discord avatar hash (Discord only). */
  avatar: string | null;
}

function keyFor(secret: string): string {
  return `${KEY_PREFIX}${createHash('sha256').update(secret).digest('hex')}`;
}

function strOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

/** Parse a stored record; anything malformed reads as absent. */
export function parsePendingIdentity(
  raw: string | null,
): PendingIdentity | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const rec: Record<string, unknown> = { ...v };
  const { provider, subject, displayName, email, avatar } = rec;
  if (provider !== 'google' && provider !== 'discord') return null;
  if (typeof subject !== 'string' || !subject) return null;
  if (typeof displayName !== 'string') return null;
  if (!strOrNull(email) || !strOrNull(avatar)) return null;
  return { provider, subject, displayName, email, avatar };
}

@Injectable()
export class PendingIdentityStore {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Park `identity` and set this browser's cookie for it. */
  async create(
    req: Pick<Request, 'secure'>,
    res: Response,
    identity: PendingIdentity,
  ): Promise<void> {
    const secret = randomBytes(32).toString('base64url');
    await this.redis.set(
      keyFor(secret),
      JSON.stringify(identity),
      'EX',
      PENDING_IDENTITY_TTL_SECONDS,
    );
    res.cookie(
      PENDING_IDENTITY_COOKIE,
      secret,
      browserBoundCookieAttrs(req, PENDING_IDENTITY_TTL_SECONDS * 1000),
    );
  }

  /** Read this browser's record without spending it. */
  async peek(req: Request): Promise<PendingIdentity | null> {
    const secret = readCookie(req, PENDING_IDENTITY_COOKIE);
    if (!secret) return null;
    return parsePendingIdentity(await this.redis.get(keyFor(secret)));
  }

  /** Spend this browser's record (atomic) and drop its cookie. */
  async consume(req: Request, res: Response): Promise<PendingIdentity | null> {
    const secret = readCookie(req, PENDING_IDENTITY_COOKIE);
    if (!secret) return null;
    res.clearCookie(PENDING_IDENTITY_COOKIE, browserBoundCookieAttrs(req));
    const key = keyFor(secret);
    const result = await this.redis.multi().get(key).del(key).exec();
    const first = result?.[0];
    const raw =
      first && !first[0] && typeof first[1] === 'string' ? first[1] : null;
    return parsePendingIdentity(raw);
  }
}
