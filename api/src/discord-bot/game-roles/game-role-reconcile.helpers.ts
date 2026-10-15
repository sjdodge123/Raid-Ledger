/**
 * ROK-1767: the DB side of the game-role reconcile — enabled links, bot
 * grants, removal hints and the `activity_log` audit rows.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { GAME_ROLES_OPT_OUT_PREF_KEY } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { GameRoleRemovalHint } from './game-role-diff.helpers';
import { playedCte } from './game-role-desired.helpers';

/** `since` for an all-time last-play lookup. */
const ALL_TIME = '1970-01-01T00:00:00.000Z';

export type GameRoleDb = PostgresJsDatabase<typeof schema>;
export type GameRoleRow = schema.DiscordGameRoleSelect;

export const GAME_ROLE_ENTITY_TYPE = 'discord_game_role';

/** Enabled links, optionally just one game's. */
export function loadEnabledGameRoles(
  db: GameRoleDb,
  gameId?: number,
): Promise<GameRoleRow[]> {
  const t = schema.discordGameRoles;
  const where =
    gameId === undefined
      ? eq(t.enabled, true)
      : and(eq(t.enabled, true), eq(t.gameId, gameId));
  return db.select().from(t).where(where).orderBy(t.id);
}

/** userId → Discord id for every member the BOT granted this role. */
export async function loadGrants(
  db: GameRoleDb,
  gameRoleId: number,
): Promise<Map<number, string>> {
  const t = schema.discordGameRoleGrants;
  const rows = await db
    .select({ userId: t.userId, discordUserId: t.discordUserId })
    .from(t)
    .where(eq(t.gameRoleId, gameRoleId));
  return new Map(rows.map((r) => [r.userId, r.discordUserId]));
}

type HintRow = {
  id: number;
  deactivated: boolean;
  opted_out: boolean;
  last_epoch: number | string | null;
} & Record<string, unknown>;

/** Why each of `userIds` no longer qualifies (opt-out, deactivated, idle). */
export async function loadRemovalHints(
  db: GameRoleDb,
  gameId: number,
  userIds: number[],
  now: Date,
): Promise<Map<number, GameRoleRemovalHint>> {
  const out = new Map<number, GameRoleRemovalHint>();
  if (userIds.length === 0) return out;
  const ids = sql.join(
    userIds.map((id) => sql`${id}`),
    sql`, `,
  );
  // Last play = presence, event attendance or Quick Play, as eligibility
  // counts it (D4, D9).
  const rows = await db.execute<HintRow>(sql`
    ${playedCte(gameId, ALL_TIME, now.toISOString())}
    SELECT u.id, u.deactivated_at IS NOT NULL AS deactivated,
      EXISTS (SELECT 1 FROM user_preferences up WHERE up.user_id = u.id
        AND up.key = ${GAME_ROLES_OPT_OUT_PREF_KEY}
        AND up.value = 'true'::jsonb) AS opted_out,
      EXTRACT(EPOCH FROM (SELECT MAX(p.played_at) FROM played p
        WHERE p.user_id = u.id))::float8 AS last_epoch
    FROM users u WHERE u.id IN (${ids})`);
  for (const r of rows) out.set(Number(r.id), toHint(r));
  return out;
}

function toHint(r: HintRow): GameRoleRemovalHint {
  if (r.opted_out) return { kind: 'opted_out' };
  if (r.deactivated) return { kind: 'deactivated' };
  const last = r.last_epoch === null ? null : Number(r.last_epoch) * 1000;
  return { kind: 'idle', lastPlayedAt: last === null ? null : new Date(last) };
}

/** Record (or refresh) a bot grant. */
export async function upsertGrant(
  db: GameRoleDb,
  gameRoleId: number,
  userId: number,
  discordUserId: string,
): Promise<void> {
  await db
    .insert(schema.discordGameRoleGrants)
    .values({ gameRoleId, userId, discordUserId })
    .onConflictDoUpdate({
      target: [
        schema.discordGameRoleGrants.gameRoleId,
        schema.discordGameRoleGrants.userId,
      ],
      set: { discordUserId, grantedAt: new Date() },
    });
}

export async function deleteGrant(
  db: GameRoleDb,
  gameRoleId: number,
  userId: number,
): Promise<void> {
  const t = schema.discordGameRoleGrants;
  await db
    .delete(t)
    .where(and(eq(t.gameRoleId, gameRoleId), eq(t.userId, userId)));
}

export interface GameRoleAuditInput {
  gameRoleId: number;
  action: 'role_added' | 'role_removed';
  userId: number;
  discordUserId: string;
  reason: string;
}

/** One `activity_log` row per Discord role mutation (spec D7). */
export async function writeAudit(
  db: GameRoleDb,
  a: GameRoleAuditInput,
): Promise<void> {
  await db.insert(schema.activityLog).values({
    entityType: GAME_ROLE_ENTITY_TYPE,
    entityId: a.gameRoleId,
    action: a.action,
    actorId: null,
    metadata: {
      userId: a.userId,
      discordUserId: a.discordUserId,
      reason: a.reason,
    },
  });
}

export async function stampReconciled(
  db: GameRoleDb,
  gameRoleId: number,
  now: Date,
): Promise<void> {
  await db
    .update(schema.discordGameRoles)
    .set({ lastReconciledAt: now })
    .where(eq(schema.discordGameRoles.id, gameRoleId));
}

type CandidateRow = {
  discord_id: string | null;
  eligible: boolean;
  granted_to: string | null;
} & Record<string, unknown>;

/** The near-real-time add's gate: snowflake, active, not opted out, no grant yet. */
export async function loadGrantCandidate(
  db: GameRoleDb,
  userId: number,
  gameRoleId: number,
): Promise<{ discordId: string; grantedTo: string | null } | null> {
  const rows = await db.execute<CandidateRow>(sql`
    SELECT u.discord_id,
      (u.deactivated_at IS NULL AND u.discord_id NOT LIKE 'local:%'
        AND u.discord_id NOT LIKE 'unlinked:%'
        AND NOT EXISTS (SELECT 1 FROM user_preferences up WHERE up.user_id = u.id
          AND up.key = ${GAME_ROLES_OPT_OUT_PREF_KEY}
          AND up.value = 'true'::jsonb)) AS eligible,
      (SELECT g.discord_user_id FROM discord_game_role_grants g
        WHERE g.game_role_id = ${gameRoleId} AND g.user_id = u.id) AS granted_to
    FROM users u WHERE u.id = ${userId} AND u.discord_id IS NOT NULL`);
  const [row] = [...rows];
  if (!row || !row.eligible || !row.discord_id) return null;
  return { discordId: row.discord_id, grantedTo: row.granted_to ?? null };
}
