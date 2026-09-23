/**
 * ROK-1537 — fleet-only: the FIRST Discord login in a test env becomes admin.
 *
 * A freshly spun fleet env lands the operator as `member` on Discord OAuth
 * (`UsersService.createOrUpdate` never sets `role`). When env-spin has no
 * configured operator id (`FLEET_ADMIN_DISCORD_ID`, handled by
 * `api/scripts/bootstrap-admin.ts::promoteFleetOperator`), this promotes the
 * identity that just completed OAuth — once, and only while no Discord-linked
 * admin exists yet.
 *
 * ALL gates must hold, otherwise nothing is written:
 *   1. `DEMO_MODE === 'true'` — not a fleet marker on its own;
 *   2. the fleet-only marker (see FLEET_FIRST_LOGIN_ENV) is exactly 'true' —
 *      set only by rl-infra env-spin, never by the allinone image, its
 *      entrypoint or any compose file (pinned by the prod-guard spec);
 *   3. the configured-id variable is empty (the configured id wins);
 *   4. no row with a real Discord id holds `role = 'admin'`. Placeholder ids
 *      (`local:` for admin@local, `unlinked:` for unlinked accounts) and
 *      null-id rows (SeedAdmin) do not count.
 *
 * Gate 4 is evaluated inside the UPDATE itself, under a transaction-scoped
 * advisory lock, so two concurrent first logins cannot both be promoted.
 * Only the logging-in user's own row (`id = $me`) is ever touched.
 */
import { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { UserRole } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { invalidateAuthUser } from './auth-user-cache';

export const FLEET_FIRST_LOGIN_ENV = 'FLEET_FIRST_DISCORD_LOGIN_ADMIN';
export const FLEET_ADMIN_ID_ENV = 'FLEET_ADMIN_DISCORD_ID';

const logger = new Logger('FleetFirstLoginAdmin');

/** Serialises concurrent first logins; key is arbitrary but fixed. */
const FIRST_LOGIN_LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('rok-1537:fleet-first-discord-login-admin'))`;

/** True when no REAL Discord identity is admin yet. */
export const NO_DISCORD_ADMIN_YET = sql`NOT EXISTS (
  SELECT 1 FROM users AS fleet_admin
  WHERE fleet_admin.discord_id IS NOT NULL
    AND fleet_admin.discord_id NOT LIKE 'local:%'
    AND fleet_admin.discord_id NOT LIKE 'unlinked:%'
    AND fleet_admin.role = 'admin')`;

/** Env gates 1–3. Pure, so the spec can pin each gate independently. */
export function isFirstLoginAdminEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.DEMO_MODE !== 'true') return false;
  if (env[FLEET_FIRST_LOGIN_ENV] !== 'true') return false;
  return (env[FLEET_ADMIN_ID_ENV] ?? '').trim() === '';
}

type LoginUser = { id: number; role: UserRole | null };

/**
 * Promote `user` to admin when every gate holds. Returns the user with the
 * role the JWT should carry. A failed promotion is logged and swallowed:
 * a fleet-only convenience must never break login.
 */
export async function promoteFirstDiscordLogin<T extends LoginUser>(
  db: PostgresJsDatabase<typeof schema>,
  user: T,
  discordId: string,
): Promise<T> {
  if (!isFirstLoginAdminEnabled() || user.role === 'admin') return user;
  let promoted: { id: number }[];
  try {
    promoted = await promoteIfNoDiscordAdmin(db, user.id);
  } catch (err) {
    logger.warn(`fleet first Discord login promotion failed: ${String(err)}`);
    return user;
  }
  if (promoted.length === 0) return user;
  invalidateAuthUser(user.id);
  logger.log(
    `fleet first Discord login → promoted discord_id ${discordId} to admin (DEMO_MODE + ${FLEET_FIRST_LOGIN_ENV} only)`,
  );
  return { ...user, role: 'admin' };
}

/** The single race-safe check-and-promote: lock, then a conditional UPDATE. */
function promoteIfNoDiscordAdmin(
  db: PostgresJsDatabase<typeof schema>,
  userId: number,
): Promise<{ id: number }[]> {
  return db.transaction(async (tx) => {
    await tx.execute(FIRST_LOGIN_LOCK);
    return tx
      .update(schema.users)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(and(eq(schema.users.id, userId), NO_DISCORD_ADMIN_YET))
      .returning({ id: schema.users.id });
  });
}
