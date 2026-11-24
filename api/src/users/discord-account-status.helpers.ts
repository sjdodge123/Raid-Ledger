/**
 * ROK-2298: one shared answer to "may this account act?" for every caller
 * that is not behind the HTTP `NotDeactivatedGuard` (Discord buttons, selects,
 * DMs, service-internal signups and nominations).
 *
 * A Discord id resolves to a tri-state — `linked | blocked | unlinked` — never
 * "blocked → null": a null would route a banned user into the anonymous
 * Discord signup path. Lives in `users/` so `events/`, `lineups/` and
 * `discord-bot/` can all import it without a cycle.
 *
 * Blocked = `bannedAt || deactivatedAt` (operator ruling 2026-11-23; a kick
 * cooldown does not block here — series join keeps its own stricter rule).
 */
import { ForbiddenException } from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
export type UserRow = typeof schema.users.$inferSelect;

/** Structured error code carried by every blocked-account refusal. */
export const ACCOUNT_BLOCKED_CODE = 'ACCOUNT_BLOCKED';
/** Neutral ephemeral copy for every gateway surface (spec §7 Q2). */
export const ACCOUNT_BLOCKED_REPLY = "This account can't do that right now.";

export type AccountBlockReason = 'banned' | 'deactivated';

export type DiscordAccount<U = UserRow> =
  | { kind: 'linked'; user: U }
  | { kind: 'blocked'; user: U; reason: AccountBlockReason }
  | { kind: 'unlinked' };

/** The two moderation columns the block decision reads. */
export interface ModerationFlags {
  bannedAt: Date | null;
  deactivatedAt: Date | null;
}

/** Why the account is blocked, or null when it may act. Ban wins. */
export function accountBlockReason(
  u: ModerationFlags,
): AccountBlockReason | null {
  if (u.bannedAt) return 'banned';
  if (u.deactivatedAt) return 'deactivated';
  return null;
}

export function isAccountBlocked(u: ModerationFlags): boolean {
  return accountBlockReason(u) !== null;
}

/** 403 `{ code: 'ACCOUNT_BLOCKED', message }` — one shape for every caller. */
export function accountBlockedError(): ForbiddenException {
  return new ForbiddenException({
    code: ACCOUNT_BLOCKED_CODE,
    message: ACCOUNT_BLOCKED_REPLY,
  });
}

/** True for the error `accountBlockedError()` builds (listener catch mapping). */
export function isAccountBlockedError(err: unknown): boolean {
  if (!(err instanceof ForbiddenException)) return false;
  const body = err.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === ACCOUNT_BLOCKED_CODE
  );
}

/** Throws `ACCOUNT_BLOCKED` for a blocked row; a missing row passes through. */
export function assertUserRowActive(u: ModerationFlags | undefined): void {
  if (u && isAccountBlocked(u)) throw accountBlockedError();
}

/**
 * Resolve a raw Discord id. An exact `discordId` match decides linked vs
 * blocked. A self-unlinked account (`discordId = 'unlinked:<id>'`, spec §7 Q3)
 * that is blocked also resolves `blocked`, so unlinking cannot dodge a ban
 * into anonymous signups; an active self-unlinked account stays `unlinked`.
 */
export async function resolveDiscordAccount(
  db: Db,
  discordId: string,
): Promise<DiscordAccount> {
  const u = schema.users;
  const rows = await db
    .select()
    .from(u)
    .where(
      or(eq(u.discordId, discordId), eq(u.discordId, `unlinked:${discordId}`)),
    )
    .limit(2);
  const exact = rows.find((r) => r.discordId === discordId);
  const candidate = exact ?? rows.find((r) => isAccountBlocked(r));
  if (!candidate) return { kind: 'unlinked' };
  const reason = accountBlockReason(candidate);
  if (reason) return { kind: 'blocked', user: candidate, reason };
  return { kind: 'linked', user: candidate };
}

/** Service gate by user id: throws `ACCOUNT_BLOCKED`; unknown ids pass. */
export async function assertAccountActive(
  db: Db,
  userId: number,
): Promise<void> {
  const u = schema.users;
  const [row] = await db
    .select({ bannedAt: u.bannedAt, deactivatedAt: u.deactivatedAt })
    .from(u)
    .where(eq(u.id, userId))
    .limit(1);
  assertUserRowActive(row);
}

/** Loads the full user row for `SignupsService.signup`, refusing a blocked one. */
export async function loadActiveUserRow(
  db: Db,
  userId: number,
): Promise<UserRow | undefined> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  assertUserRowActive(user);
  return user;
}
