/**
 * Tiebreaker reminder helpers (ROK-1117).
 *
 * Resolves the target user set for the tiebreaker reminder cron and
 * filters out users who have already engaged (vetoed for veto mode, or
 * voted on every active-round matchup for bracket mode). Kept in its
 * own file so `lineup-reminder.service.ts` stays under the 300-line
 * ESLint ceiling.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { loadExpectedVoters } from './quorum/quorum-voters.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Active tiebreaker + parent lineup row needed by the reminder cron. */
export interface ActiveTiebreakerRow {
  tiebreakerId: number;
  lineupId: number;
  mode: 'bracket' | 'veto';
  roundDeadline: Date;
  currentRound: number;
}

interface RawTiebreakerRow {
  tiebreakerId: number;
  lineupId: number;
  mode: 'bracket' | 'veto';
  roundDeadline: Date | string;
  currentRound: number;
}

/**
 * Find every lineup with an active tiebreaker that has a future
 * `round_deadline`. We re-derive the `currentRound` from the maximum
 * matchup round so the bracket-engagement filter only counts votes on
 * the round that is currently open.
 */
export async function findActiveTiebreakersWithDeadline(
  db: Db,
): Promise<ActiveTiebreakerRow[]> {
  const rows = (await db.execute(sql`
    SELECT t.id        AS "tiebreakerId",
           t.lineup_id AS "lineupId",
           t.mode      AS "mode",
           t.round_deadline AS "roundDeadline",
           COALESCE(MAX(m.round), 1) AS "currentRound"
      FROM community_lineup_tiebreakers t
      LEFT JOIN community_lineup_tiebreaker_bracket_matchups m
        ON m.tiebreaker_id = t.id
     WHERE t.status = 'active'
       AND t.round_deadline IS NOT NULL
       AND t.round_deadline > NOW()
     GROUP BY t.id
  `)) as unknown as RawTiebreakerRow[];
  return rows.map(normalizeTiebreakerRow);
}

function normalizeTiebreakerRow(r: RawTiebreakerRow): ActiveTiebreakerRow {
  return {
    ...r,
    roundDeadline:
      r.roundDeadline instanceof Date
        ? r.roundDeadline
        : new Date(r.roundDeadline),
    currentRound: Number(r.currentRound) || 1,
  };
}

/** Find user IDs who have submitted a veto for this tiebreaker. */
async function findVetoEngagedUserIds(
  db: Db,
  tiebreakerId: number,
): Promise<Set<number>> {
  const rows = await db
    .select({ userId: schema.communityLineupTiebreakerVetoes.userId })
    .from(schema.communityLineupTiebreakerVetoes)
    .where(
      eq(schema.communityLineupTiebreakerVetoes.tiebreakerId, tiebreakerId),
    );
  return new Set(rows.map((r) => r.userId));
}

/**
 * Find user IDs who have voted on every matchup in the active round.
 * Users still missing votes on at least one matchup are NOT engaged
 * and remain valid reminder targets.
 */
async function findBracketEngagedUserIds(
  db: Db,
  tiebreakerId: number,
  currentRound: number,
): Promise<Set<number>> {
  const matchupCount = await countActiveRoundMatchups(
    db,
    tiebreakerId,
    currentRound,
  );
  if (matchupCount === 0) return new Set();
  const counts = await loadVoteCountsPerUser(db, tiebreakerId, currentRound);
  return new Set(
    counts.filter((c) => Number(c.voted) >= matchupCount).map((c) => c.userId),
  );
}

async function countActiveRoundMatchups(
  db: Db,
  tiebreakerId: number,
  round: number,
): Promise<number> {
  const rows = await db
    .select({ id: schema.communityLineupTiebreakerBracketMatchups.id })
    .from(schema.communityLineupTiebreakerBracketMatchups)
    .where(
      and(
        eq(
          schema.communityLineupTiebreakerBracketMatchups.tiebreakerId,
          tiebreakerId,
        ),
        eq(schema.communityLineupTiebreakerBracketMatchups.round, round),
        eq(schema.communityLineupTiebreakerBracketMatchups.isBye, false),
      ),
    );
  return rows.length;
}

async function loadVoteCountsPerUser(
  db: Db,
  tiebreakerId: number,
  round: number,
): Promise<Array<{ userId: number; voted: number }>> {
  return (await db.execute(sql`
    SELECT user_id AS "userId", COUNT(DISTINCT matchup_id)::int AS "voted"
      FROM community_lineup_tiebreaker_bracket_votes
     WHERE matchup_id IN (
       SELECT id FROM community_lineup_tiebreaker_bracket_matchups
        WHERE tiebreaker_id = ${tiebreakerId}
          AND round = ${round}
          AND is_bye = false
     )
     GROUP BY user_id
  `)) as unknown as Array<{ userId: number; voted: number }>;
}

/** Resolve already-engaged user IDs for a tiebreaker (mode-aware). */
export async function findEngagedUserIds(
  db: Db,
  tb: ActiveTiebreakerRow,
): Promise<Set<number>> {
  if (tb.mode === 'veto') return findVetoEngagedUserIds(db, tb.tiebreakerId);
  return findBracketEngagedUserIds(db, tb.tiebreakerId, tb.currentRound);
}

/**
 * Resolve the candidate target user IDs for a tiebreaker reminder:
 * `loadExpectedVoters` (visibility-aware) minus users who have already
 * engaged with this tiebreaker.
 */
export async function resolveReminderTargets(
  db: Db,
  tb: ActiveTiebreakerRow,
): Promise<number[]> {
  const [lineup] = await db
    .select()
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, tb.lineupId))
    .limit(1);
  if (!lineup) return [];
  const [expected, engaged] = await Promise.all([
    loadExpectedVoters(db, lineup),
    findEngagedUserIds(db, tb),
  ]);
  return expected.filter((id) => !engaged.has(id));
}

/** Classify the reminder threshold from hours-until-deadline. */
export function classifyThreshold(hoursLeft: number): '24h' | '1h' | null {
  if (hoursLeft <= 0 || hoursLeft > 24) return null;
  return hoursLeft <= 1 ? '1h' : '24h';
}
