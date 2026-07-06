/**
 * Moderation cascade orchestration (ROK-313 §9.5). Composes the ordered,
 * lockout-FIRST side effects around the DB writes so `UsersService` stays a thin
 * set of delegators (< 300 lines). Deliberately does NOT reuse
 * `deactivateUserOrchestrated`: that path mis-logs a "left the guild"
 * notification and bails the whole cascade (incl. token revoke) when the target
 * is already deactivated — banning a prior guild-leaver would then skip revoke.
 *
 * Ordering invariant (§9.1): the DB write precedes `invalidateAuthUser` so a
 * concurrent request can't repopulate the ~30s auth cache with a stale
 * not-banned row. Lockout (write → cache drop → revoke) precedes the best-effort
 * cascade (signups / wipe / Discord) so a mid-way failure still leaves the
 * account locked.
 */
import { Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { RefreshTokenService } from '../auth/refresh/refresh-token.service';
import type { SignupsRosterService } from '../events/signups-roster.service';
import { invalidateAuthUser } from '../auth/auth-user-cache';
import { cancelAllUpcomingSignupsForUser } from '../events/signup-cancel-batch.helpers';
import { insertAdminAction } from './users-admin-actions.helpers';
import {
  banUserById,
  kickUserById,
  unbanUserById,
  unkickUserById,
  type ModerationRow,
} from './users-moderation.helpers';
import { reassignPugSlots, wipeUserData } from './users-delete.helpers';

type Db = PostgresJsDatabase<typeof schema>;

export interface ModerationResult {
  success: boolean;
  message: string;
}

/** Structural view of the one Discord method the cascade calls (kept minimal so
 * this module doesn't hard-depend on DiscordBotModule internals). */
export interface DiscordKicker {
  kickMember(discordId: string, reason?: string): Promise<boolean>;
}

export interface ModerationDeps {
  db: Db;
  logger: Logger;
  refreshTokenService: RefreshTokenService | null;
  rosterService: SignupsRosterService | null;
  discord: DiscordKicker;
}

export interface KickInput {
  userId: number;
  actorId: number;
  reason?: string;
  kickFromDiscord: boolean;
}

export interface BanInput extends KickInput {
  wipeData: boolean;
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

/** A Discord ID is a joinable guild member only when present and not a synthetic
 * `local:` / `unlinked:` sentinel. */
function isRealDiscordId(discordId: string | null): discordId is string {
  return (
    !!discordId &&
    !discordId.startsWith('local:') &&
    !discordId.startsWith('unlinked:')
  );
}

/** Best-effort refresh-family revoke (lockout). Never throws. */
async function revokeTokens(
  deps: ModerationDeps,
  userId: number,
): Promise<void> {
  if (!deps.refreshTokenService) return;
  try {
    await deps.refreshTokenService.revokeAllForUser(userId);
  } catch (err: unknown) {
    deps.logger.warn(
      `ROK-313: refresh revoke for user ${userId} failed: ${msg(err)}`,
    );
  }
}

/** Best-effort Discord guild kick. Returns whether a kick was dispatched. */
async function maybeKickFromDiscord(
  deps: ModerationDeps,
  row: ModerationRow,
  kickFromDiscord: boolean,
  reason?: string,
): Promise<boolean> {
  if (!kickFromDiscord || !isRealDiscordId(row.discordId)) return false;
  try {
    return await deps.discord.kickMember(row.discordId, reason);
  } catch (err: unknown) {
    deps.logger.warn(
      `ROK-313: Discord kick for user ${row.id} failed: ${msg(err)}`,
    );
    return false;
  }
}

/** Best-effort cancel of every upcoming signup (drop from rosters). Never throws. */
async function cancelUpcomingSignups(
  deps: ModerationDeps,
  userId: number,
): Promise<void> {
  if (!deps.rosterService) return;
  try {
    const n = await cancelAllUpcomingSignupsForUser(
      deps.db,
      deps.rosterService,
      userId,
    );
    deps.logger.log(
      `ROK-313: cancelled ${n} upcoming signup(s) for banned user ${userId}`,
    );
  } catch (err: unknown) {
    deps.logger.warn(
      `ROK-313: signup cancel for user ${userId} failed: ${msg(err)}`,
    );
  }
}

/** Kick (soft removal): lockout + audit + optional Discord kick. No signup
 * cancel / no deactivate — kick preserves data (AC2). */
export async function runKick(
  deps: ModerationDeps,
  input: KickInput,
): Promise<ModerationResult> {
  const row = await kickUserById(deps.db, input.userId, input.reason);
  if (!row)
    return { success: true, message: 'User is already kicked or banned.' };
  invalidateAuthUser(row.id);
  await revokeTokens(deps, row.id);
  await insertAdminAction(deps.db, {
    action: 'kick',
    actorId: input.actorId,
    targetId: row.id,
    reason: input.reason ?? null,
    metadata: JSON.stringify({ discordKicked: input.kickFromDiscord }),
  });
  await maybeKickFromDiscord(deps, row, input.kickFromDiscord, input.reason);
  deps.logger.log(`ROK-313: kicked user ${row.id} (${row.username})`);
  return { success: true, message: `${row.username} has been kicked.` };
}

/** Clear a kick + drop the auth cache so the user can re-auth immediately. */
export async function runUnkick(
  deps: ModerationDeps,
  userId: number,
  actorId: number,
): Promise<ModerationResult> {
  const row = await unkickUserById(deps.db, userId);
  if (!row) return { success: true, message: 'User is not kicked.' };
  invalidateAuthUser(row.id);
  await insertAdminAction(deps.db, {
    action: 'unkick',
    actorId,
    targetId: row.id,
    reason: null,
    metadata: null,
  });
  return { success: true, message: `${row.username}'s kick has been cleared.` };
}

/** Post-lockout best-effort cascade for ban: cancel signups, wipe or reassign,
 * optional Discord kick. */
async function banCascade(
  deps: ModerationDeps,
  input: BanInput,
  row: ModerationRow,
): Promise<void> {
  await cancelUpcomingSignups(deps, row.id);
  if (input.wipeData) {
    await deps.db.transaction(async (tx) => {
      await wipeUserData(tx, row.id, input.actorId);
    });
  } else {
    await reassignPugSlots(deps.db, row.id, input.actorId);
  }
  await maybeKickFromDiscord(deps, row, input.kickFromDiscord, input.reason);
}

/** Ban: lockout-first (write → cache drop → revoke → audit) then the best-effort
 * cascade. Idempotent — a repeat ban returns success without re-logging. */
export async function runBan(
  deps: ModerationDeps,
  input: BanInput,
): Promise<ModerationResult> {
  const row = await banUserById(deps.db, input.userId, input.reason);
  if (!row) return { success: true, message: 'User is already banned.' };
  invalidateAuthUser(row.id);
  await revokeTokens(deps, row.id);
  await insertAdminAction(deps.db, {
    action: 'ban',
    actorId: input.actorId,
    targetId: row.id,
    reason: input.reason ?? null,
    metadata: JSON.stringify({
      dataWiped: input.wipeData,
      discordKicked: input.kickFromDiscord,
    }),
  });
  await banCascade(deps, input, row);
  deps.logger.log(`ROK-313: banned user ${row.id} (${row.username})`);
  return { success: true, message: `${row.username} has been banned.` };
}

/** Clear a ban + drop the auth cache. Reactivation (Players list) is separate. */
export async function runUnban(
  deps: ModerationDeps,
  userId: number,
  actorId: number,
): Promise<ModerationResult> {
  const row = await unbanUserById(deps.db, userId);
  if (!row) return { success: true, message: 'User is not banned.' };
  invalidateAuthUser(row.id);
  await insertAdminAction(deps.db, {
    action: 'unban',
    actorId,
    targetId: row.id,
    reason: null,
    metadata: null,
  });
  return { success: true, message: `${row.username}'s ban has been lifted.` };
}
