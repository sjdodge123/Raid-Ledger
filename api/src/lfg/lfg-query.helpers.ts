/**
 * Read-side helpers for LFG intents (ROK-1451).
 *
 * Every query here applies the two eligibility rules from the spec:
 *   1. "Active" means `status = 'active'` AND `expires_at > now()` — the cron
 *      is bookkeeping, never the source of truth.
 *   2. Deactivated / banned holders are excluded from counts, members and
 *      state derivation (ROK-313 guard family).
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  isNull,
  min,
  notInArray,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  LfgGroupSummaryDto,
  LfgHeartedGameDto,
  LfgMemberDto,
  LfgState,
} from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { LFG_LIST_LIMIT } from './lfg.constants';

export type LfgDb = PostgresJsDatabase<typeof schema>;

/** Raw aggregate shape shared by the group list and single-group reads. */
export interface LfgGroupAggregate {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  viabilityThreshold: number | null;
  activeCount: number;
  soonestExpiresAt: Date | null;
  hasOwnIntent: boolean;
}

/**
 * Derive the group state from the number of eligible active intents.
 *
 * @param activeCount - Eligible active intents on the game.
 * @returns `'lfg'` at 1, `'lfm'` at 2+, `null` at 0.
 */
export function deriveLfgState(activeCount: number): LfgState {
  if (activeCount >= 2) return 'lfm';
  if (activeCount === 1) return 'lfg';
  return null;
}

/**
 * Derive the viability signal. Exposed for consumers to render; never acted on.
 *
 * @param activeCount - Eligible active intents on the game.
 * @param threshold - `games.cooptimusOnlineMax`, or null when unknown.
 * @returns True only when a real threshold exists and the group has met it.
 */
export function deriveViability(
  activeCount: number,
  threshold: number | null,
): boolean {
  if (threshold === null) return false;
  if (activeCount < 1) return false;
  return activeCount >= threshold;
}

/**
 * SQL predicate: a `users` row every LFG read still counts (ROK-313 family).
 *
 * Shared by all four LFG reads so the eligibility rule lives in ONE place —
 * the owner / heart / activity queries elsewhere in the codebase each omit it
 * (`igdb-steam-interest.helpers.ts`, `availability.service.ts`), so anything
 * reading those tables from LFG has to add it back.
 *
 * Requires `users` to be joined into the query.
 */
export function eligibleUser() {
  return and(isNull(schema.users.deactivatedAt), isNull(schema.users.bannedAt));
}

/** SQL predicate: an intent row that genuinely counts right now. */
function liveIntent(now: Date) {
  return and(
    eq(schema.lfgIntents.status, 'active'),
    gt(schema.lfgIntents.expiresAt, now),
    eligibleUser(),
  );
}

/** Project a raw aggregate row into the wire DTO. */
export function toGroupSummary(row: LfgGroupAggregate): LfgGroupSummaryDto {
  return {
    gameId: row.gameId,
    gameName: row.gameName,
    gameCoverUrl: row.gameCoverUrl,
    activeCount: row.activeCount,
    state: deriveLfgState(row.activeCount),
    viabilityThreshold: row.viabilityThreshold,
    isViable: deriveViability(row.activeCount, row.viabilityThreshold),
    hasOwnIntent: row.hasOwnIntent,
    soonestExpiresAt: row.soonestExpiresAt?.toISOString() ?? null,
  };
}

/** Columns every group aggregate selects. */
function groupColumns(viewerId: number) {
  return {
    gameId: schema.games.id,
    gameName: schema.games.name,
    gameCoverUrl: schema.games.coverUrl,
    viabilityThreshold: schema.games.cooptimusOnlineMax,
    activeCount: count(),
    soonestExpiresAt: min(schema.lfgIntents.expiresAt),
    hasOwnIntent: sql<boolean>`bool_or(${schema.lfgIntents.userId} = ${viewerId})`,
  };
}

/**
 * `GET /lfg` — every game with at least one eligible active intent.
 *
 * @param db - Drizzle handle.
 * @param viewerId - Caller, used to compute `hasOwnIntent`.
 * @returns Group summaries ordered by `activeCount` desc, then soonest expiry.
 */
export async function listActiveGroups(
  db: LfgDb,
  viewerId: number,
): Promise<LfgGroupSummaryDto[]> {
  const rows = await db
    .select(groupColumns(viewerId))
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .innerJoin(schema.games, eq(schema.games.id, schema.lfgIntents.gameId))
    .where(liveIntent(new Date()))
    .groupBy(schema.games.id)
    .orderBy(desc(count()), asc(min(schema.lfgIntents.expiresAt)))
    .limit(LFG_LIST_LIMIT);
  return rows.map((r) => toGroupSummary(r));
}

/**
 * Aggregate a single game's group. Returns a zero-count summary when the game
 * exists but nobody is looking — an empty group is a valid read, not an error.
 *
 * @param db - Drizzle handle.
 * @param game - The already-loaded game row.
 * @param viewerId - Caller, used to compute `hasOwnIntent`.
 */
export async function getGroupSummary(
  db: LfgDb,
  game: typeof schema.games.$inferSelect,
  viewerId: number,
): Promise<LfgGroupSummaryDto> {
  const [row] = await db
    .select(groupColumns(viewerId))
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .innerJoin(schema.games, eq(schema.games.id, schema.lfgIntents.gameId))
    .where(and(eq(schema.lfgIntents.gameId, game.id), liveIntent(new Date())))
    .groupBy(schema.games.id);
  if (!row) {
    return toGroupSummary({
      gameId: game.id,
      gameName: game.name,
      gameCoverUrl: game.coverUrl,
      viabilityThreshold: game.cooptimusOnlineMax,
      activeCount: 0,
      soonestExpiresAt: null,
      hasOwnIntent: false,
    });
  }
  return toGroupSummary(row);
}

/**
 * Roster for a group — eligible active holders only, oldest intent first.
 *
 * @param db - Drizzle handle.
 * @param gameId - Game whose group to read.
 */
export async function listGroupMembers(
  db: LfgDb,
  gameId: number,
): Promise<LfgMemberDto[]> {
  const rows = await db
    .select({
      userId: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      avatar: schema.users.avatar,
      customAvatarUrl: schema.users.customAvatarUrl,
      expiresAt: schema.lfgIntents.expiresAt,
      joinedAt: schema.lfgIntents.createdAt,
    })
    .from(schema.lfgIntents)
    .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
    .where(and(eq(schema.lfgIntents.gameId, gameId), liveIntent(new Date())))
    .orderBy(asc(schema.lfgIntents.createdAt), asc(schema.lfgIntents.id));
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    displayName: r.displayName,
    avatarUrl: r.customAvatarUrl ?? r.avatar,
    expiresAt: r.expiresAt.toISOString(),
    joinedAt: r.joinedAt.toISOString(),
  }));
}

/** Correlated count of eligible active intents for the joined `games` row.
 * The instant is passed as an ISO string: drizzle hands raw template params
 * straight to postgres.js, which cannot Bind a bare `Date`. */
function eligibleCountSubquery(now: Date) {
  return sql<number>`(
    SELECT COUNT(*)::int FROM lfg_intents li
    JOIN users lu ON lu.id = li.user_id
    WHERE li.game_id = ${schema.games.id}
      AND li.status = 'active' AND li.expires_at > ${now.toISOString()}
      AND lu.deactivated_at IS NULL AND lu.banned_at IS NULL
  )`;
}

/** Project a hearted-game row onto the wire DTO. */
function toHeartedGame(row: {
  gameId: number;
  gameName: string;
  gameCoverUrl: string | null;
  heartedAt: Date;
  activeCount: number;
}): LfgHeartedGameDto {
  return {
    gameId: row.gameId,
    gameName: row.gameName,
    gameCoverUrl: row.gameCoverUrl,
    heartedAt: row.heartedAt.toISOString(),
    activeCount: Number(row.activeCount),
  };
}

/** Games the viewer already holds a live intent for — excluded from hearts. */
function ownLiveIntents(db: LfgDb, viewerId: number, now: Date) {
  return db
    .select({ gameId: schema.lfgIntents.gameId })
    .from(schema.lfgIntents)
    .where(
      and(
        eq(schema.lfgIntents.userId, viewerId),
        eq(schema.lfgIntents.status, 'active'),
        gt(schema.lfgIntents.expiresAt, now),
      ),
    );
}

/**
 * `GET /lfg/hearted` — the caller's manual hearts with no active intent of
 * their own. Strictly read-only: LFG never writes to `game_interests`.
 *
 * @param db - Drizzle handle.
 * @param viewerId - Caller whose hearts to read.
 */
export async function listHeartedWithoutIntent(
  db: LfgDb,
  viewerId: number,
): Promise<LfgHeartedGameDto[]> {
  const now = new Date();
  const rows = await db
    .select({
      gameId: schema.games.id,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      heartedAt: schema.gameInterests.createdAt,
      activeCount: eligibleCountSubquery(now),
    })
    .from(schema.gameInterests)
    .innerJoin(schema.games, eq(schema.games.id, schema.gameInterests.gameId))
    .where(
      and(
        eq(schema.gameInterests.userId, viewerId),
        eq(schema.gameInterests.source, 'manual'),
        notInArray(
          schema.gameInterests.gameId,
          ownLiveIntents(db, viewerId, now),
        ),
      ),
    )
    .orderBy(desc(schema.gameInterests.createdAt))
    .limit(LFG_LIST_LIMIT);
  return rows.map(toHeartedGame);
}
