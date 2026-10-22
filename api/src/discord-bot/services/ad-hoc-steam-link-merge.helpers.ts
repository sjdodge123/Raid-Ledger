/**
 * ROK-1888 L4 (ruling 2) — merge-on-link. When a user links Steam mid-session,
 * the unlinked server row carrying that SteamID on a live/grace Quick Play
 * becomes theirs: folded into their voice row when they have one, else
 * claimed in place (a linked server row). Future sessions already merge at
 * insert (`ad-hoc-steam-participant.helpers.ts`).
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { withParticipantLock } from './ad-hoc-participant-lock';
import { UNLINKED_SERVER_ROW_SQL } from './ad-hoc-unlinked-row.sql';

type Db = PostgresJsDatabase<typeof schema>;
const p = schema.adHocParticipants;
const e = schema.events;

/** A live Quick Play the merge touched — what the caller re-renders. */
export interface MergedEvent {
  eventId: number;
  channelBindingId: string | null;
}

interface UnlinkedHit extends MergedEvent {
  rowId: string;
}

/** Unlinked rows with this SteamID on live / grace ad-hoc events. */
async function findUnlinkedRows(
  db: Db,
  steamId: string,
): Promise<UnlinkedHit[]> {
  return db
    .select({
      rowId: p.id,
      eventId: p.eventId,
      channelBindingId: e.channelBindingId,
    })
    .from(p)
    .innerJoin(e, eq(e.id, p.eventId))
    .where(
      and(
        eq(p.steamId, steamId),
        UNLINKED_SERVER_ROW_SQL,
        eq(e.isAdHoc, true),
        inArray(e.adHocStatus, ['live', 'grace_period']),
        isNull(e.cancelledAt),
      ),
    );
}

/** The user's own voice row on the event that has no SteamID yet. */
async function findVoiceRow(db: Db, eventId: number, userId: number) {
  const [row] = await db
    .select({ id: p.id })
    .from(p)
    .where(
      and(
        eq(p.eventId, eventId),
        eq(p.userId, userId),
        isNotNull(p.discordUserId),
        isNull(p.steamId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Fold the steam row into the voice row. The steam row is deleted FIRST:
 * the `(event_id, steam_id)` unique index forbids two rows holding the
 * SteamID, and the identity CHECK forbids clearing it on a Discord-less row.
 * Two ordered statements, neither of which can violate (no catch-and-retry
 * inside a transaction — CLAUDE.md). The delete's RETURNING gates the fold,
 * so a replayed link finds nothing and changes nothing.
 */
async function foldIntoVoiceRow(
  tx: Db,
  steamRowId: string,
  voiceRowId: string,
): Promise<void> {
  const [steam] = await tx
    .delete(p)
    .where(and(eq(p.id, steamRowId), UNLINKED_SERVER_ROW_SQL))
    .returning();
  if (!steam) return;
  await tx
    .update(p)
    .set({
      steamId: steam.steamId,
      onServer: sql`${p.onServer} OR ${steam.onServer}`,
      pelicanServerId: steam.pelicanServerId,
      characterName: steam.characterName,
      characterOwnerId: steam.characterOwnerId,
      ...mergedAttendance(steam),
    })
    .where(eq(p.id, voiceRowId));
}

/**
 * Codex r1 P2 — both rows' attendance, each counted once. Banked totals and
 * session counts add up. An open steam session keeps the merged row open; its
 * clock starts at the union of the two open sessions, or — when the voice row
 * had closed — at the steam session's start, never before the voice leave
 * (that time is already banked). A closed steam row leaves the voice clock.
 */
function mergedAttendance(steam: typeof p.$inferSelect) {
  const banked = steam.totalDurationSeconds ?? 0;
  const base = {
    totalDurationSeconds: sql`COALESCE(${p.totalDurationSeconds}, 0) + ${banked}`,
    sessionCount: sql`${p.sessionCount} + ${steam.sessionCount}`,
  };
  if (steam.leftAt !== null) return base;
  const start = sql.param(steam.joinedAt, p.joinedAt);
  return {
    ...base,
    leftAt: null,
    joinedAt: sql`CASE WHEN ${p.leftAt} IS NULL THEN LEAST(${p.joinedAt}, ${start}) ELSE GREATEST(${start}, ${p.leftAt}) END`,
  };
}

/** Claim the steam row for the user; it renders and counts as linked. */
async function claimRow(tx: Db, rowId: string, userId: number): Promise<void> {
  const [user] = await tx
    .select({
      name: sql<string>`COALESCE(${schema.users.displayName}, ${schema.users.username})`,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  await tx
    .update(p)
    .set({ userId, ...(user ? { discordUsername: user.name } : {}) })
    .where(and(eq(p.id, rowId), UNLINKED_SERVER_ROW_SQL));
}

/** Merge one hit under the per-(event, user) participant lock. */
function mergeHit(db: Db, hit: UnlinkedHit, userId: number): Promise<void> {
  return withParticipantLock(db, hit.eventId, userId, async (tx) => {
    const voice = await findVoiceRow(tx, hit.eventId, userId);
    if (voice) await foldIntoVoiceRow(tx, hit.rowId, voice.id);
    else await claimRow(tx, hit.rowId, userId);
  });
}

/**
 * Attach every live unlinked row carrying `steamId` to `userId`.
 *
 * @returns The events whose roster changed, for the caller to re-render.
 */
export async function mergeUnlinkedRowsOnLink(
  db: Db,
  userId: number,
  steamId: string,
): Promise<MergedEvent[]> {
  const hits = await findUnlinkedRows(db, steamId);
  for (const hit of hits) await mergeHit(db, hit, userId);
  return hits.map(({ eventId, channelBindingId }) => ({
    eventId,
    channelBindingId,
  }));
}
