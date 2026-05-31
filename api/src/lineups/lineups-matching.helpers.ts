/**
 * Matching algorithm for community lineups (ROK-936).
 * Runs on voting -> decided transition to create match records.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import {
  countVotesPerGame,
  countDistinctVoters,
} from './lineups-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Fit category based on voter count vs game capacity. */
export type FitCategory =
  | 'perfect'
  | 'oversubscribed'
  | 'undersubscribed'
  | 'normal';

/**
 * Build match records for a lineup transitioning to 'decided'.
 * Creates community_lineup_matches and community_lineup_match_members rows.
 *
 * ROK-1306: wipes pre-existing `suggested`/`scheduling` matches for the lineup
 * before re-inserting. This is the "decide" event — a fresh snapshot of the
 * vote tally — so any leftover rows from an earlier decide (then-reverted) or
 * a half-finished prior transaction must not survive. Without this, the UQ on
 * (lineupId, gameId) caused `onConflictDoNothing` to silently drop the new
 * INSERT and the lineup ended up wired to a stale match row whose `linkedEvent`
 * / scheduling slots still pointed at the old game's poll (wrong-game-link).
 *
 * Caller note: `runMatchingAlgorithm` invokes this AFTER `applyStatusUpdate`
 * has flipped the lineup row to `decided`. `scheduled`/`archived` matches are
 * preserved (only `suggested`/`scheduling` are wiped) because those statuses
 * represent committed downstream state we must not blow away.
 */
export async function buildMatchesForLineup(
  db: Db,
  lineupId: number,
): Promise<void> {
  const [lineup] = await db
    .select({
      matchThreshold: schema.communityLineups.matchThreshold,
      includeSchedulingPhase: schema.communityLineups.includeSchedulingPhase,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) return;

  const threshold = lineup.matchThreshold ?? 35;
  // ROK-1302: when scheduling is disabled, threshold-met matches must NOT
  // enter 'scheduling' status — the lineup terminates at Decided.
  const canSchedule = lineup.includeSchedulingPhase ?? true;
  const [voteCounts, voterRows] = await Promise.all([
    countVotesPerGame(db, lineupId),
    countDistinctVoters(db, lineupId),
  ]);

  const totalVoters = voterRows[0]?.total ?? 0;

  // ROK-1225 / ROK-1306: wipe-then-insert runs inside ONE transaction so
  // concurrent auto-advance callers can't interleave a stale-match wipe with
  // another caller's fresh insert. The wipe must ALSO run for zero-vote
  // re-decides (operator force-decides via tiebreaker / decidedGameId) so
  // stale `suggested`/`scheduling` rows from a prior decide can't survive.
  await db.transaction(async (tx) => {
    await wipeStaleMatches(tx, lineupId);
    if (totalVoters === 0) return;
    for (const vc of voteCounts) {
      if (vc.voteCount === 0) continue;
      await insertMatch(tx, lineupId, vc, totalVoters, threshold, canSchedule);
    }
  });
}

/**
 * Delete any pre-existing matches in `suggested`/`scheduling` status for this
 * lineup so the upcoming insert pass starts from a clean slate. FK cascade
 * clears `community_lineup_match_members` and `community_lineup_schedule_slots`.
 * `scheduled`/`archived` rows are intentionally preserved.
 */
async function wipeStaleMatches(tx: Tx, lineupId: number): Promise<void> {
  await tx
    .delete(schema.communityLineupMatches)
    .where(
      and(
        eq(schema.communityLineupMatches.lineupId, lineupId),
        inArray(schema.communityLineupMatches.status, [
          'suggested',
          'scheduling',
        ]),
      ),
    );
}

/** Insert a single match row and its member rows. */
async function insertMatch(
  tx: Tx,
  lineupId: number,
  vc: { gameId: number; voteCount: number },
  totalVoters: number,
  threshold: number,
  canSchedule: boolean,
): Promise<void> {
  const pct = (vc.voteCount / totalVoters) * 100;
  const thresholdMet = pct >= threshold;
  // ROK-1302: `thresholdMet` always reflects the vote math so the info isn't
  // lost; `status` only reaches 'scheduling' when the lineup opted into the
  // scheduling phase. Flag OFF → every match stays 'suggested' (terminal).
  const status: 'scheduling' | 'suggested' =
    canSchedule && thresholdMet ? 'scheduling' : 'suggested';
  const fitCategory = await computeFitCategory(tx, vc.gameId, vc.voteCount);

  // ROK-1306: with the wipe above, the unique (lineupId, gameId) constraint
  // can now only collide with a preserved `scheduled`/`archived` row. Keep
  // `onConflictDoNothing` so the rare race against an already-
  // promoted match is a no-op instead of a 23505.
  const [match] = await tx
    .insert(schema.communityLineupMatches)
    .values({
      lineupId,
      gameId: vc.gameId,
      status,
      thresholdMet,
      voteCount: vc.voteCount,
      votePercentage: pct.toFixed(2),
      fitType: fitCategory,
    })
    .onConflictDoNothing({
      target: [
        schema.communityLineupMatches.lineupId,
        schema.communityLineupMatches.gameId,
      ],
    })
    .returning({ id: schema.communityLineupMatches.id });
  if (!match) return;
  await insertMatchMembers(tx, lineupId, match.id, vc.gameId);
}

/** Determine fit category from voter count and game player limits. */
async function computeFitCategory(
  db: Db,
  gameId: number,
  voterCount: number,
): Promise<FitCategory> {
  const [game] = await db
    .select({ playerCount: schema.games.playerCount })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  if (!game?.playerCount) return 'normal';
  const { min, max } = game.playerCount;
  if (voterCount > max) return 'oversubscribed';
  if (voterCount < min) return 'undersubscribed';
  return 'perfect';
}

/** Insert match member rows for all voters of a specific game. */
async function insertMatchMembers(
  db: Db,
  lineupId: number,
  matchId: number,
  gameId: number,
): Promise<void> {
  const rows = await db
    .select({ userId: schema.communityLineupVotes.userId })
    .from(schema.communityLineupVotes)
    .where(
      and(
        eq(schema.communityLineupVotes.lineupId, lineupId),
        eq(schema.communityLineupVotes.gameId, gameId),
      ),
    );
  if (rows.length === 0) return;

  // ROK-1225: idempotent against `uq_match_member_user` so a retry/race
  // can't surface 23505 to the caller. Combined with the migration that
  // restored the missing FK on match_id, an orphan key collision now
  // becomes a no-op insert rather than a 500.
  await db
    .insert(schema.communityLineupMatchMembers)
    .values(
      rows.map((r) => ({
        matchId,
        userId: r.userId,
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
