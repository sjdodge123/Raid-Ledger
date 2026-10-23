/**
 * Database query helpers for standalone scheduling polls (ROK-977).
 * Keeps the service layer thin by extracting all DB operations here.
 */
import { NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { selectCompletionTarget } from './standalone-poll-complete.helpers';
import { defined } from '../../common/defined.helpers';
import { insertWithSlugRetry } from '../public-lineup-slug.helpers';
import { activeUsersFilter } from '../../users/users-active.helpers';
// ROK-1893 P3: moved to its own module (hub join); re-exported for callers.
export { findActiveStandalonePolls } from './standalone-poll-active.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** Fetch a game by ID, returning name and cover URL. */
export async function findGameById(
  db: Db,
  gameId: number,
): Promise<{ id: number; name: string; coverUrl: string | null } | null> {
  const [game] = await db
    .select({
      id: schema.games.id,
      name: schema.games.name,
      coverUrl: schema.games.coverUrl,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return game ?? null;
}

/** Check whether an event exists by ID. */
export async function eventExists(db: Db, eventId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.events.id })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return !!row;
}

/** Filter user IDs to those that exist in the users table. */
export async function filterValidUserIds(
  db: Db,
  userIds: number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(inArray(schema.users.id, userIds), activeUsersFilter()));
  return rows.map((r) => r.id);
}

/** The poll's game, or 404 (moved out of the service for its line cap). */
export async function requirePollGame(
  db: Db,
  gameId: number,
): Promise<{ id: number; name: string; coverUrl: string | null }> {
  const game = await findGameById(db, gameId);
  if (!game) throw new NotFoundException('Game not found');
  return game;
}

/**
 * Insert a lineup in 'decided' status.
 * Uses direct db.insert() to bypass the active lineup conflict check.
 */
export async function insertDecidedLineup(
  db: Db,
  userId: number,
  linkedEventId: number | undefined,
  phaseDeadline: Date | null,
  share: { visibility: 'public' | 'private'; shareToken: string | null } = {
    visibility: 'public',
    shareToken: null,
  },
  guildId: number | null = null,
): Promise<{ id: number }> {
  // ROK-1067: standalone polls are not user-shareable, but `public_slug` is
  // NOT NULL — generate a slug and disable share so the URL never resolves.
  // Use the retry helper so a 23505 collision against the global UNIQUE
  // constraint doesn't surface as a 500 to the user (mirrors the main
  // lineup-creation path in LineupsService).
  return insertWithSlugRetry(async (slug) => {
    const [row] = await db
      .insert(schema.communityLineups)
      .values({
        // Synthetic title — this lineup row is only a storage vehicle for a
        // standalone scheduling poll and is hidden from lineup queries by
        // `phaseDurationOverride.standalone`. Not surfaced in any UI.
        title: 'Standalone Scheduling Poll',
        status: 'decided',
        createdBy: userId,
        linkedEventId: linkedEventId ?? null,
        phaseDeadline,
        /* Mark as standalone so community lineup queries exclude it.
           Uses existing JSONB column — no migration needed. */
        phaseDurationOverride: { standalone: true },
        publicSlug: slug,
        publicShareEnabled: false,
        // ROK-1750: private polls carry a share-link token; public ones null.
        visibility: share.visibility,
        shareToken: share.shareToken,
        // ROK-1893 P3: the hub the poll is tagged to (validated by the caller).
        guildId,
      })
      .returning({ id: schema.communityLineups.id });
    return defined(row, 'inserted standalone lineup row');
  });
}

/** Insert a match in 'scheduling' status with thresholdMet = true. */
export async function insertSchedulingMatch(
  db: Db,
  lineupId: number,
  gameId: number,
  linkedEventId: number | undefined,
  minVoteThreshold?: number,
): Promise<{ id: number }> {
  const [row] = await db
    .insert(schema.communityLineupMatches)
    .values({
      lineupId,
      gameId,
      status: 'scheduling',
      thresholdMet: true,
      voteCount: 0,
      linkedEventId: linkedEventId ?? null,
      minVoteThreshold: minVoteThreshold ?? null,
    })
    .returning({ id: schema.communityLineupMatches.id });
  return defined(row, 'inserted scheduling match row');
}

/** Insert match member rows from a list of user IDs. */
export async function insertMatchMembers(
  db: Db,
  matchId: number,
  userIds: number[],
): Promise<void> {
  if (userIds.length === 0) return;
  const unique = [...new Set(userIds)];
  // ROK-1225: idempotent against `uq_match_member_user` so a retry/race
  // can't surface 23505 to the caller.
  await db
    .insert(schema.communityLineupMatchMembers)
    .values(
      unique.map((userId) => ({
        matchId,
        userId,
        source: 'voted' as const,
      })),
    )
    .onConflictDoNothing({
      target: [
        schema.communityLineupMatchMembers.matchId,
        schema.communityLineupMatchMembers.userId,
      ],
    });
}

/**
 * Atomically stamp reschedulingPollId on an event.
 * Guard: only stamps if reschedulingPollId IS NULL AND cancelledAt IS NULL.
 * Returns true if stamped, false if event is already rescheduling or cancelled.
 */
export async function stampReschedulingPollId(
  db: Db,
  eventId: number,
  matchId: number,
): Promise<boolean> {
  const result = await db
    .update(schema.events)
    .set({ reschedulingPollId: matchId })
    .where(
      and(
        eq(schema.events.id, eventId),
        sql`${schema.events.reschedulingPollId} IS NULL`,
        sql`${schema.events.cancelledAt} IS NULL`,
      ),
    )
    .returning({ id: schema.events.id });
  return result.length > 0;
}

/**
 * Clear reschedulingPollId on an event (used on poll expiry).
 * Does NOT cancel the event — just removes the linkage.
 */
export async function clearReschedulingPollId(
  db: Db,
  eventId: number,
): Promise<void> {
  await db
    .update(schema.events)
    .set({ reschedulingPollId: null })
    .where(eq(schema.events.id, eventId));
}

/**
 * Complete a standalone poll: set match to 'scheduled', archive the lineup,
 * and release any linked event's rescheduling lock. Returns linkedEventId if
 * one was released.
 *
 * ROK-1370: the reschedule-lock flow moves the linked event IN PLACE to the
 * winning time via PATCH /events/:id/reschedule (which keeps the event id +
 * Discord Scheduled Event + signups and notifies signups) BEFORE calling this.
 * We must therefore only clear `reschedulingPollId` here — cancelling the event
 * (the old behavior) silently undid the reschedule and skipped notifications,
 * leaving the just-rescheduled event out of sync.
 */
export async function completeStandalonePoll(
  db: Db,
  matchId: number,
): Promise<{
  ok: boolean;
  /** ROK-1844: the poll was no longer `scheduling` — already completed. */
  conflict?: true;
  linkedEventId?: number;
  linkedEventCancelled?: boolean;
}> {
  const match = await selectCompletionTarget(db, matchId);
  if (!match) return { ok: false };
  if (!(await flipAndArchive(db, match))) return { ok: false, conflict: true };
  return {
    ok: true,
    ...(match.linkedEventId != null
      ? { linkedEventId: match.linkedEventId }
      : {}),
    linkedEventCancelled: match.linkedEventCancelled,
  };
}

/**
 * ROK-1844: compare-and-set the match `scheduling` → `scheduled`, then archive
 * the lineup and release the linked event's lock. False when the poll was no
 * longer `scheduling`, so a repeat call changes nothing (and the caller fires
 * no second round of signups or DMs).
 */
function flipAndArchive(
  db: Db,
  match: { id: number; lineupId: number; linkedEventId: number | null },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const flipped = await tx
      .update(schema.communityLineupMatches)
      .set({ status: 'scheduled' })
      .where(
        and(
          eq(schema.communityLineupMatches.id, match.id),
          eq(schema.communityLineupMatches.status, 'scheduling'),
        ),
      )
      .returning({ id: schema.communityLineupMatches.id });
    if (flipped.length === 0) return false;
    await tx
      .update(schema.communityLineups)
      .set({ status: 'archived' })
      .where(eq(schema.communityLineups.id, match.lineupId));
    // ROK-1370: release the lock only — the event was already moved to the
    // winning time in place. Do NOT cancel it.
    if (match.linkedEventId)
      await clearReschedulingPollId(tx, match.linkedEventId);
    return true;
  });
}

/**
 * Clear reschedulingPollId on all events linked to matches
 * in the given lineup (used on poll expiry / archive).
 */
export async function clearLinkedEventsByLineup(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const matches = await db
    .select({ linkedEventId: schema.communityLineupMatches.linkedEventId })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.lineupId, lineupId));

  const cleared: number[] = [];
  for (const m of matches) {
    if (m.linkedEventId) {
      await clearReschedulingPollId(db, m.linkedEventId);
      cleared.push(m.linkedEventId);
    }
  }
  return cleared;
}

/** Count members for a given match. */
export async function countMatchMembers(
  db: Db,
  matchId: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.communityLineupMatchMembers)
    .where(eq(schema.communityLineupMatchMembers.matchId, matchId));
  return row?.count ?? 0;
}

/**
 * Count active RL-member signups on an event — the reschedule-poll audience.
 * Mirrors findRosterMembers (standalone-poll-notification.service.ts): only
 * signed_up/tentative rows with a user_id (anonymous Discord signups can't
 * vote, so they don't count toward a threshold).
 */
export async function countActiveEventSignups(
  db: Db,
  eventId: number,
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        inArray(schema.eventSignups.status, ['signed_up', 'tentative']),
        sql`${schema.eventSignups.userId} IS NOT NULL`,
      ),
    );
  return row?.count ?? 0;
}
