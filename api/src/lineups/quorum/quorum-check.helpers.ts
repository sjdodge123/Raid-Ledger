/**
 * Quorum predicates for lineup auto-advance (ROK-1118, ROK-1296, ROK-1444).
 *
 * Building quorum — ready ONLY when the ROK-1444 count target fires: the entry
 * count has crossed the per-lineup `nomination_target_pct` share of the
 * dynamic nomination cap, with total nominations ≥ floor (settings). See
 * `nomination-target.helpers.ts` for the revert-trap guard that keeps it from
 * re-firing on a standing count after an operator revert. Otherwise the
 * building phase advances on its deadline or by a manual advance.
 *
 * TDB:449: the ROK-1296 building-phase submission quorum (every expected
 * voter stamping `nominations_submitted_at`) is retired — no client ever
 * mounted the nominations Submit step, so that branch could never fire. The
 * column is retained but no longer written or read here.
 *
 * Voting quorum:
 *   - every expected voter has stamped `votes_submitted_at`, behind the
 *     ≥2-voter "solo lineup" guard.
 *
 * ROK-1296 pivot: the per-voter voting gate checks submission presence
 * rather than raw vote counts. Operators repeatedly asked "how many
 * actually said they were done?" — autosave-touch counts were the wrong
 * signal. The explicit Submit ritual carries the "I'm done" semantic;
 * autosave only protects in-flight work.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  SETTING_KEYS,
  type SettingKey,
} from '../../drizzle/schema/app-settings';
import type { SettingsService } from '../../settings/settings.service';
import { loadQuorumGatingVoters } from './quorum-voters.helpers';
import { evaluateNominationTarget } from './nomination-target.helpers';
import {
  detectTies,
  type TieResult,
} from '../tiebreaker/tiebreaker-detect.helpers';
import { resolveApprovalTieByStars } from '../tiebreaker/tiebreaker-star.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

const DEFAULT_MIN_NOMINATIONS = 4;

/** ROK-1374: the reason string returned when a completed vote is undecidable. */
export const TIE_AWAITING_PICK_REASON = 'tie awaiting a pick';

export interface QuorumResult {
  ready: boolean;
  reason?: string;
  /**
   * ROK-1374 (D1): set when every expected voter has submitted but the vote
   * produced joint-top games, i.e. a completed-but-undecidable result. Callers
   * use its presence to open a tie hold instead of attempting a transition
   * that `guardTiebreakerOnTransition` is guaranteed to reject.
   */
  tie?: TieResult;
}

/**
 * Building → voting quorum predicate.
 *
 * Only the ROK-1444 count target can make the building phase ready. With no
 * target configured, or one not yet met, the lineup waits for its phase
 * deadline or a manual advance (TDB:449 retired the submission branch).
 */
export async function checkBuildingQuorum(
  db: Db,
  settings: SettingsService,
  lineup: LineupRow,
): Promise<QuorumResult> {
  // TDB:460: the floor and total are the target's only inputs. No per-voter
  // roster or submission rows are read on the building path.
  const totalNominations = await countNominations(db, lineup.id);
  const floor = await readMinNominations(settings);

  // ROK-1444: configuring a target is an explicit operator opt-in that says
  // "open voting once there are enough games", so it needs no ≥2-voter guard —
  // a lineup where one keen person nominates everything (the same-day
  // "Tonight" case) must still honour the target the create modal advertised.
  // The global floor still gates the advance, so this can never fire on one
  // or two games.
  //
  // `checkVotingQuorum` deliberately KEEPS its solo guard: others can still
  // turn up to vote once voting is open, and the phase deadline advances the
  // lineup regardless, so a solo lineup cannot get stuck by this.
  if (lineup.nominationTargetPct != null) {
    const target = await evaluateNominationTarget(
      db,
      lineup,
      totalNominations,
      floor,
    );
    if (target.ready) return target;
  }

  return {
    ready: false,
    reason:
      lineup.nominationTargetPct == null
        ? 'no nomination target; deadline or manual advance required'
        : 'nomination target not met; deadline or manual advance required',
  };
}

/**
 * Voting → decided quorum predicate.
 *
 * ROK-1374 (D1): quorum is the *decidability* predicate, so a completed vote
 * that ended in a tie is NOT ready. Before this, quorum returned `ready: true`
 * on a tie and handed a doomed transition to the grace job, which caught the
 * resulting `TIEBREAKER_REQUIRED` and silently cleared `pending_advance_at` —
 * the dead-end where the banner vanished and nothing replaced it.
 */
export async function checkVotingQuorum(
  db: Db,
  lineup: LineupRow,
): Promise<QuorumResult> {
  const expected = await loadQuorumGatingVoters(db, lineup);
  // Drain the per-voter query unconditionally so the mock drizzle queue
  // (used by unit tests) consumes the same number of calls as the real
  // path. The result is only consulted after the ≥2-voter guard.
  const submitted = await loadVoteSubmitters(db, lineup.id);
  // Same reason, same rule: the tie probe is issued on EVERY branch, before
  // the solo guard, so the flat mock's call sequence never depends on the
  // outcome. Its result is only consulted once quorum is otherwise met.
  const tie = await detectTies(db, lineup.id);
  // ROK-1474 (D7): a tie the top picks can break is not a tie, so quorum
  // must not park on it — the transition guard resolves it the same way and
  // the two must never disagree. Only probed when a tie exists, so a
  // no-tie lineup issues exactly the queries it does today.
  const stars = tie
    ? await resolveApprovalTieByStars(db, lineup.id, tie)
    : null;
  if (expected.length < 2) {
    return { ready: false, reason: 'solo lineup; manual advance required' };
  }
  const shortfall = countMissingSubmissions(expected, submitted);
  if (shortfall > 0) {
    return {
      ready: false,
      reason: `${shortfall} expected voter(s) have not submitted`,
    };
  }
  if (tie && stars?.kind !== 'winner') {
    return { ready: false, reason: TIE_AWAITING_PICK_REASON, tie };
  }
  return { ready: true };
}

/** Distinct userIds with `votes_submitted_at IS NOT NULL`. */
async function loadVoteSubmitters(
  db: Db,
  lineupId: number,
): Promise<Set<number>> {
  const rows = await db
    .select({
      userId: schema.communityLineupUserSubmissions.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.communityLineupUserSubmissions)
    .where(
      and(
        eq(schema.communityLineupUserSubmissions.lineupId, lineupId),
        isNotNull(schema.communityLineupUserSubmissions.votesSubmittedAt),
      ),
    )
    .groupBy(schema.communityLineupUserSubmissions.userId);
  return new Set(rows.map((r) => r.userId));
}

/** Count how many `expected` voter ids are missing from `submitted`. */
function countMissingSubmissions(
  expected: number[],
  submitted: Set<number>,
): number {
  return expected.filter((id) => !submitted.has(id)).length;
}

async function countNominations(db: Db, lineupId: number): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId))
    .execute();
  return Number(rows[0]?.total ?? 0);
}

async function readMinNominations(settings: SettingsService): Promise<number> {
  return readPositiveSetting(
    settings,
    SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS,
    DEFAULT_MIN_NOMINATIONS,
  );
}

async function readPositiveSetting(
  settings: SettingsService,
  key: SettingKey,
  fallback: number,
): Promise<number> {
  const raw = await settings.get(key);
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? fallback : parsed;
}
