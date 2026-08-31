/**
 * Quorum predicates for lineup auto-advance (ROK-1118, ROK-1296).
 *
 * Building quorum — ready when EITHER branch passes:
 *   a) ROK-1444: the entry count has crossed the per-lineup
 *      `nomination_target_pct` share of the dynamic nomination cap, or
 *   b) every expected voter has stamped `nominations_submitted_at`.
 *   ...and, for both, total nominations ≥ floor (settings).
 *
 * (a) is checked FIRST and is exempt from the ≥2-voter solo guard — see the
 * comment on the guard for why.
 *
 * Branch (b) exists because (a) is currently unreachable from the web app —
 * `useSubmitNominations` is defined but mounted nowhere, so nothing writes the
 * stamp (a) reads. See `nomination-target.helpers.ts` for the revert-trap guard
 * that keeps (b) from re-firing on a standing count after an operator revert.
 *
 * Voting quorum:
 *   - every expected voter has stamped `votes_submitted_at`.
 *
 * ROK-1296 pivot: the per-voter gate switched from counting raw entries /
 * votes to checking submission presence. Operators repeatedly asked "how
 * many actually said they were done?" — autosave-touch counts were the
 * wrong signal. The explicit Submit ritual now carries the "I'm done"
 * semantic; autosave only protects in-flight work.
 *
 * ≥2-voter "solo lineup" guard and the building-phase nomination floor
 * stay intact.
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

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

const DEFAULT_MIN_NOMINATIONS = 4;

export interface QuorumResult {
  ready: boolean;
  reason?: string;
}

/** Building → voting quorum predicate. */
export async function checkBuildingQuorum(
  db: Db,
  settings: SettingsService,
  lineup: LineupRow,
): Promise<QuorumResult> {
  const expected = await loadQuorumGatingVoters(db, lineup);
  const totalNominations = await countNominations(db, lineup.id);
  const floor = await readMinNominations(settings);

  // ROK-1444: the count target is evaluated BEFORE the ≥2-voter guard.
  //
  // Configuring a target is an explicit operator opt-in that says "open voting
  // once there are enough games", so it outranks the ROK-1118 solo guard —
  // otherwise a lineup where one keen person nominates everything (exactly the
  // same-day "Tonight" case this feature was built for) silently ignores the
  // target the create modal advertised. The global floor still gates the
  // advance, so this can never fire on one or two games.
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

  if (expected.length < 2) {
    return { ready: false, reason: 'solo lineup; manual advance required' };
  }
  const submitted = await loadNominationSubmitters(db, lineup.id);
  const shortfall = countMissingSubmissions(expected, submitted);
  if (shortfall > 0) {
    return {
      ready: false,
      reason: `${shortfall} expected nominator(s) have not submitted`,
    };
  }
  if (totalNominations < floor) {
    return {
      ready: false,
      reason: `nomination floor not met (${totalNominations}/${floor})`,
    };
  }
  return { ready: true };
}

/** Voting → decided quorum predicate. */
export async function checkVotingQuorum(
  db: Db,
  lineup: LineupRow,
): Promise<QuorumResult> {
  const expected = await loadQuorumGatingVoters(db, lineup);
  // Drain the per-voter query unconditionally so the mock drizzle queue
  // (used by unit tests) consumes the same number of calls as the real
  // path. The result is only consulted after the ≥2-voter guard.
  const submitted = await loadVoteSubmitters(db, lineup.id);
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
  return { ready: true };
}

/** Distinct userIds with `nominations_submitted_at IS NOT NULL`. */
async function loadNominationSubmitters(
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
        isNotNull(schema.communityLineupUserSubmissions.nominationsSubmittedAt),
      ),
    )
    .groupBy(schema.communityLineupUserSubmissions.userId);
  return new Set(rows.map((r) => r.userId));
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
