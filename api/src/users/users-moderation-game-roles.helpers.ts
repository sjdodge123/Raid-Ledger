/**
 * ROK-1767: a ban+wipe deletes the bot's game-role grant rows. Without them
 * the reconcile reads the roles as hand-assigned and never removes them, so
 * the wipe first takes back every role the bot granted. Best-effort like the
 * rest of the moderation cascade: a failure is logged + reported and the wipe
 * still proceeds (the Discord kick, when requested, drops the roles anyway).
 */
import type { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Guild } from 'discord.js';
import * as schema from '../drizzle/schema';
import { removeMemberRole } from '../discord-bot/game-roles/game-role-discord.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const REASON = 'Raid Ledger: user banned with data wipe';

function report(logger: Logger, userId: number, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  logger.warn(
    `ROK-1767: game-role revoke for wiped user ${userId} failed: ${detail}`,
  );
  Sentry.captureException(err, { tags: { userId: String(userId) } });
}

function loadGrants(db: Db, userId: number) {
  const g = schema.discordGameRoleGrants;
  const r = schema.discordGameRoles;
  return db
    .select({ roleId: r.roleId, discordUserId: g.discordUserId })
    .from(g)
    .innerJoin(r, eq(g.gameRoleId, r.id))
    .where(eq(g.userId, userId));
}

/** Remove every bot-granted game role from the user. Never throws. */
export async function revokeGameRoleGrants(
  db: Db,
  guild: Guild | null,
  userId: number,
  logger: Logger,
): Promise<void> {
  try {
    const grants = await loadGrants(db, userId);
    if (grants.length === 0) return;
    if (!guild) throw new Error('Discord bot offline; roles left in place');
    for (const { roleId, discordUserId } of grants) {
      await removeMemberRole(guild, discordUserId, roleId, REASON).catch(
        (err: unknown) => report(logger, userId, err),
      );
    }
  } catch (err) {
    report(logger, userId, err);
  }
}
