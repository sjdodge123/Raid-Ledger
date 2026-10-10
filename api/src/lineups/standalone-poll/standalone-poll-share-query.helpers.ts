/**
 * DB queries for private standalone polls shared by link (ROK-1750).
 *
 * Only PRIVATE, STANDALONE lineups resolve: a token on any other lineup row
 * (none should exist) is treated as unknown, so the preview / redeem paths can
 * never be pointed at a community lineup.
 */
import { and, asc, count, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { generateShareToken } from './standalone-poll-share.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type DbOrTx = Db | Tx;

/** What the share paths need to know about a private standalone poll. */
export interface SharedPoll {
  lineupId: number;
  matchId: number;
  createdBy: number | null;
  lineupStatus: string | null;
  phaseDeadline: Date | null;
  matchStatus: string;
  linkedEventId: number | null;
  gameName: string;
  gameCoverUrl: string | null;
  creatorDisplayName: string;
}

const privateStandalone = and(
  eq(schema.communityLineups.visibility, 'private'),
  sql`${schema.communityLineups.phaseDurationOverride}->>'standalone' = 'true'`,
);

/** Select + joins shared by both lookups; the caller adds the WHERE. */
function selectSharedPoll(db: DbOrTx) {
  return db
    .select({
      lineupId: schema.communityLineups.id,
      matchId: schema.communityLineupMatches.id,
      createdBy: schema.communityLineups.createdBy,
      lineupStatus: schema.communityLineups.status,
      phaseDeadline: schema.communityLineups.phaseDeadline,
      matchStatus: schema.communityLineupMatches.status,
      linkedEventId: schema.communityLineupMatches.linkedEventId,
      gameName: schema.games.name,
      gameCoverUrl: schema.games.coverUrl,
      displayName: schema.users.displayName,
      username: schema.users.username,
    })
    .from(schema.communityLineups)
    .innerJoin(
      schema.communityLineupMatches,
      eq(schema.communityLineupMatches.lineupId, schema.communityLineups.id),
    )
    .innerJoin(
      schema.games,
      eq(schema.games.id, schema.communityLineupMatches.gameId),
    )
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.communityLineups.createdBy),
    );
}

type SharedPollRow = Awaited<ReturnType<typeof selectSharedPoll>>[number];

function toSharedPoll(row: SharedPollRow): SharedPoll {
  const { displayName, username, ...rest } = row;
  return { ...rest, creatorDisplayName: displayName || username || 'Someone' };
}

/** Resolve a private standalone poll by its share token, or null. */
export async function findPollByShareToken(
  db: DbOrTx,
  token: string,
): Promise<SharedPoll | null> {
  const [row] = await selectSharedPoll(db)
    .where(
      and(eq(schema.communityLineups.shareToken, token), privateStandalone),
    )
    .orderBy(asc(schema.communityLineupMatches.id))
    .limit(1);
  return row ? toSharedPoll(row) : null;
}

/** Resolve a private standalone poll by its match id, or null. */
export async function findPrivatePollByMatchId(
  db: DbOrTx,
  matchId: number,
): Promise<SharedPoll | null> {
  const [row] = await selectSharedPoll(db)
    .where(
      and(eq(schema.communityLineupMatches.id, matchId), privateStandalone),
    )
    .limit(1);
  return row ? toSharedPoll(row) : null;
}

/** Proposed times for the open/closed decision (ROK-1607 rule). */
export async function findSlotTimes(db: DbOrTx, matchId: number) {
  const rows = await db
    .select({ t: schema.communityLineupScheduleSlots.proposedTime })
    .from(schema.communityLineupScheduleSlots)
    .where(eq(schema.communityLineupScheduleSlots.matchId, matchId));
  return rows.map((r) => r.t);
}

/** Member count for the preview card. */
export async function countPollMembers(
  db: DbOrTx,
  matchId: number,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.communityLineupMatchMembers)
    .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  return row?.n ?? 0;
}

/**
 * Upsert invitee rows (idempotent on `uq_lineup_invitee_user`).
 *
 * @returns How many rows were newly inserted.
 */
export async function insertInvitees(
  db: DbOrTx,
  lineupId: number,
  userIds: number[],
  invitedBy: number | null,
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const inserted = await db
    .insert(schema.communityLineupInvitees)
    .values(unique.map((userId) => ({ lineupId, userId, invitedBy })))
    .onConflictDoNothing({
      target: [
        schema.communityLineupInvitees.lineupId,
        schema.communityLineupInvitees.userId,
      ],
    })
    .returning({ id: schema.communityLineupInvitees.id });
  return inserted.length;
}

/** Add one match member (idempotent on `uq_match_member_user`). */
export async function insertMatchMember(
  db: DbOrTx,
  matchId: number,
  userId: number,
): Promise<void> {
  await db
    .insert(schema.communityLineupMatchMembers)
    .values({ matchId, userId, source: 'voted' as const })
    .onConflictDoNothing({
      target: [
        schema.communityLineupMatchMembers.matchId,
        schema.communityLineupMatchMembers.userId,
      ],
    });
}

/** Replace a lineup's share token; the old one stops resolving at once. */
export async function rotateShareToken(
  db: DbOrTx,
  lineupId: number,
): Promise<string> {
  const shareToken = generateShareToken();
  await db
    .update(schema.communityLineups)
    .set({ shareToken })
    .where(eq(schema.communityLineups.id, lineupId));
  return shareToken;
}
