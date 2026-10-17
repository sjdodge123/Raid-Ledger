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
import { resolvePlayerCap } from './lineups-match-response.helpers';
import type { OrphanedPollCard } from './lineups-scheduling-hook.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What one matching pass hands its caller to act on after commit. */
export interface MatchingPassResult {
  /** Ids this pass wrote in `scheduling` status (ROK-1473). */
  schedulingMatchIds: number[];
  /** Poll cards owned by matches the wipe deleted (TDB:571). */
  orphanedCards: OrphanedPollCard[];
}

/** Fit category based on voter count vs game capacity. */
export type FitCategory =
  'perfect' | 'oversubscribed' | 'undersubscribed' | 'normal';

/**
 * Build match records for a lineup transitioning to 'decided'.
 * Creates community_lineup_matches and community_lineup_match_members rows.
 *
 * ROK-1473: returns the ids of the matches this pass wrote in `scheduling`
 * status so the caller can announce them AFTER the transaction commits (see
 * `fireMatchEnteredScheduling`). Collecting inside the transaction and
 * returning is deliberate — announcing inside it would advertise a poll a
 * rollback then erased.
 *
 * ROK-1306: wipes pre-existing `suggested`/`scheduling` matches for the lineup
 * before re-inserting. This is the "decide" event — a fresh snapshot of the
 * vote tally — so any leftover rows from an earlier decide (then-reverted) or
 * a half-finished prior transaction must not survive. Without this, the UQ on
 * (lineupId, gameId) caused `onConflictDoNothing` to silently drop the new
 * INSERT and the lineup ended up wired to a stale match row whose `linkedEvent`
 * / scheduling slots still pointed at the old game's poll (wrong-game-link).
 *
 * TDB:571: a wiped `scheduling` match may already own a Discord poll card.
 * The wipe returns those card refs so the caller can delete the cards after
 * commit — the same collect-then-announce rule as the ids above.
 *
 * Caller note: `runMatchingAlgorithm` invokes this AFTER `applyStatusUpdate`
 * has flipped the lineup row to `decided`. `scheduled`/`archived` matches are
 * preserved (only `suggested`/`scheduling` are wiped) because those statuses
 * represent committed downstream state we must not blow away.
 */
export async function buildMatchesForLineup(
  db: Db,
  lineupId: number,
): Promise<MatchingPassResult> {
  const [lineup] = await db
    .select({
      matchThreshold: schema.communityLineups.matchThreshold,
      includeSchedulingPhase: schema.communityLineups.includeSchedulingPhase,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!lineup) return { schedulingMatchIds: [], orphanedCards: [] };

  const [voteCounts, voterRows] = await Promise.all([
    countVotesPerGame(db, lineupId),
    countDistinctVoters(db, lineupId),
  ]);
  return rebuildMatches(db, lineupId, {
    voteCounts,
    totalVoters: voterRows[0]?.total ?? 0,
    threshold: lineup.matchThreshold ?? 35,
    // ROK-1302: when scheduling is disabled, threshold-met matches must NOT
    // enter 'scheduling' status — the lineup terminates at Decided.
    canSchedule: lineup.includeSchedulingPhase ?? true,
  });
}

/** Inputs of one wipe-then-insert pass. */
interface RebuildInput {
  voteCounts: { gameId: number; voteCount: number }[];
  totalVoters: number;
  threshold: number;
  canSchedule: boolean;
}

/**
 * ROK-1225 / ROK-1306: wipe-then-insert runs inside ONE transaction so
 * concurrent auto-advance callers can't interleave a stale-match wipe with
 * another caller's fresh insert. The wipe must ALSO run for zero-vote
 * re-decides (operator force-decides via tiebreaker / decidedGameId) so
 * stale `suggested`/`scheduling` rows from a prior decide can't survive.
 */
async function rebuildMatches(
  db: Db,
  lineupId: number,
  input: RebuildInput,
): Promise<MatchingPassResult> {
  return db.transaction(async (tx) => {
    const result: MatchingPassResult = {
      schedulingMatchIds: [],
      orphanedCards: await wipeStaleMatches(tx, lineupId),
    };
    if (input.totalVoters === 0) return result;
    for (const vc of input.voteCounts) {
      if (vc.voteCount === 0) continue;
      const id = await insertMatch(
        tx,
        lineupId,
        vc,
        input.totalVoters,
        input.threshold,
        input.canSchedule,
      );
      if (id !== null) result.schedulingMatchIds.push(id);
    }
    return result;
  });
}

/**
 * Delete any pre-existing matches in `suggested`/`scheduling` status for this
 * lineup so the upcoming insert pass starts from a clean slate. FK cascade
 * clears `community_lineup_match_members` and `community_lineup_schedule_slots`.
 * `scheduled`/`archived` rows are intentionally preserved.
 *
 * @returns The poll cards the deleted rows owned (TDB:571), read by the
 * DELETE itself so no concurrent writer can slip a card in between.
 */
async function wipeStaleMatches(
  tx: Tx,
  lineupId: number,
): Promise<OrphanedPollCard[]> {
  const wiped = await tx
    .delete(schema.communityLineupMatches)
    .where(
      and(
        eq(schema.communityLineupMatches.lineupId, lineupId),
        inArray(schema.communityLineupMatches.status, [
          'suggested',
          'scheduling',
        ]),
      ),
    )
    .returning({
      embedChannelId: schema.communityLineupMatches.embedChannelId,
      embedMessageId: schema.communityLineupMatches.embedMessageId,
    });
  return wiped.flatMap((row) =>
    row.embedChannelId && row.embedMessageId
      ? [{ channelId: row.embedChannelId, messageId: row.embedMessageId }]
      : [],
  );
}

/**
 * Insert a single match row and its member rows.
 *
 * @returns The match id when this insert put the match into `scheduling`
 * status (ROK-1473 — the caller announces it post-commit), else null.
 */
async function insertMatch(
  tx: Tx,
  lineupId: number,
  vc: { gameId: number; voteCount: number },
  totalVoters: number,
  threshold: number,
  canSchedule: boolean,
): Promise<number | null> {
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
  if (!match) return null;
  await insertMatchMembers(tx, lineupId, match.id, vc.gameId);
  return status === 'scheduling' ? match.id : null;
}

/** Capacity bounds for a game, as stored (never pre-blended). */
export interface FitBounds {
  /** RAW `games.cooptimus_online_max` — positive / 0 / null. */
  cooptimusOnlineMax: number | null;
  /** IGDB `games.player_count`. */
  playerCount: { min: number; max: number } | null;
}

/**
 * ROK-1401: pure capacity classification.
 *
 * This is the CAPACITY concern, not the co-op-CLAIM concern. The max follows
 * the shared ROK-1411 precedence via {@link resolvePlayerCap} (positive
 * cooptimus wins; `0`/null fall THROUGH to the IGDB max) — do not add a third
 * precedence helper. The min is always IGDB: Co-Optimus publishes no minimum.
 * With neither bound usable the match stays `'normal'`.
 *
 * The co-op badge rule ("✓ fits N" / "⚠ M-player co-op") is deliberately
 * DIFFERENT — Co-Optimus-positive only, never IGDB. See
 * `web/src/components/lineups/coop-fit.ts`.
 */
export function classifyFit(
  bounds: FitBounds,
  voterCount: number,
): FitCategory {
  const max = resolvePlayerCap(
    bounds.cooptimusOnlineMax,
    bounds.playerCount?.max ?? null,
  );
  const min = bounds.playerCount?.min ?? null;
  if (max == null && min == null) return 'normal';
  if (max != null && voterCount > max) return 'oversubscribed';
  if (min != null && voterCount < min) return 'undersubscribed';
  return 'perfect';
}

/** Thin DB wrapper: load the bounds for a game and delegate to classifyFit. */
async function computeFitCategory(
  db: Db,
  gameId: number,
  voterCount: number,
): Promise<FitCategory> {
  const [game] = await db
    .select({
      playerCount: schema.games.playerCount,
      cooptimusOnlineMax: schema.games.cooptimusOnlineMax,
    })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);

  if (!game) return 'normal';
  return classifyFit(
    {
      cooptimusOnlineMax: game.cooptimusOnlineMax ?? null,
      playerCount: game.playerCount ?? null,
    },
    voterCount,
  );
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
