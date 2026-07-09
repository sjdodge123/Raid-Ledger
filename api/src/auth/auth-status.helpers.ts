/**
 * ROK-313: shared kick/ban auth-status enforcement.
 *
 * One home for the cooldown constant, the user-facing messages, and the
 * login-time assertions so every auth surface (local login, Discord OAuth,
 * and the per-request jwt.strategy check) agrees on the exact boundary and
 * copy. Kept as free functions (no DI) so files that enforce them stay lean.
 */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { users } from '../drizzle/schema';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from './auth-user-cache';

/**
 * Kick cooldown window. A kicked user is locked out of every auth path for
 * this long; once it elapses the kick auto-clears on the next login attempt.
 * Imported by BOTH the jwt.strategy per-request check AND
 * `assertKickCooldownOrClear` so the boundary is defined exactly once (§9.3).
 */
export const KICK_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Structured error code the Discord-OAuth failure redirect recognises so it
 * can thread the ban reason into the login redirect (§9.7). The local-login
 * path reads `.message` instead.
 */
export const USER_SUSPENDED_CODE = 'USER_SUSPENDED';

/**
 * Structured error code for a kick-cooldown 401. Lets the Discord-OAuth failure
 * redirect recognise the cooldown throw and thread its message to the login
 * screen (AC4) — symmetric with USER_SUSPENDED. Stays a 401 (§9.2).
 */
export const USER_KICKED_CODE = 'USER_KICKED';

/** Minimal ban-status shape (a `users` row satisfies it structurally). */
interface BanStatus {
  bannedAt: Date | null;
  banReason: string | null;
}

/** Minimal kick-status shape (a `users` row satisfies it structurally). */
interface KickStatus {
  id: number;
  kickedAt: Date | null;
}

/** Suspension copy shown on every login surface (local + Discord + jwt). */
export function suspendedMessage(banReason: string | null): string {
  return (
    'Your account has been suspended' + (banReason ? ': ' + banReason : '')
  );
}

/** Cooldown copy with remaining whole minutes (floored to a 1-minute minimum). */
export function kickCooldownMessage(kickedAt: Date): string {
  const remainingMs = kickedAt.getTime() + KICK_COOLDOWN_MS - Date.now();
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Your session was ended by an administrator. You may log in again in ${minutes} minute(s).`;
}

/** True once the kick cooldown window has fully elapsed. */
export function isKickExpired(kickedAt: Date): boolean {
  return Date.now() >= kickedAt.getTime() + KICK_COOLDOWN_MS;
}

/**
 * Throw a structured USER_SUSPENDED `ForbiddenException` when the user is
 * banned. Structured (code + message + reason) so the Discord-OAuth failure
 * path can recognise it and thread the reason into the login redirect; the
 * local path just surfaces `.message`.
 */
export function assertNotBanned(user: BanStatus): void {
  if (!user.bannedAt) return;
  throw new ForbiddenException({
    code: USER_SUSPENDED_CODE,
    message: suspendedMessage(user.banReason),
    reason: user.banReason,
  });
}

/**
 * Enforce the kick cooldown at login time. Within the window → 401 with the
 * remaining-minutes message. Past the window → clear `kicked_at`/`kick_reason`
 * THEN invalidate the auth cache (clear-then-invalidate, §9.3) and continue,
 * so the stale kicked row can't keep serving a 401 after the cooldown expires.
 */
export async function assertKickCooldownOrClear(
  db: PostgresJsDatabase<typeof schema>,
  user: KickStatus,
): Promise<void> {
  if (!user.kickedAt) return;
  if (!isKickExpired(user.kickedAt)) {
    // Structured 401 so the Discord-OAuth failure path can thread the cooldown
    // message (AC4); the local path still reads `.message` off the object form.
    const message = kickCooldownMessage(user.kickedAt);
    throw new UnauthorizedException({
      code: USER_KICKED_CODE,
      message,
      reason: message,
    });
  }
  await db
    .update(users)
    .set({ kickedAt: null, kickReason: null })
    .where(eq(users.id, user.id));
  invalidateAuthUser(user.id);
}
