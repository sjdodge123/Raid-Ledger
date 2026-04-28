/**
 * Quorum predicates for lineup auto-advance (ROK-1118).
 *
 * Building quorum: every expected voter has nominated ≥ minPerVoter games
 *   AND total distinct nominations ≥ floor (settings).
 * Voting quorum: every expected voter has cast their FULL vote allotment
 *   (`lineup.maxVotesPerPlayer`).
 *
 * The ≥1 / ≥1 thresholds were too eager — operator confirmed a private
 * lineup auto-advanced after each voter cast 1 of 3 votes. Both predicates
 * now require participants to use their full allotment so people can't
 * skip the room ahead by being first.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import {
  SETTING_KEYS,
  type SettingKey,
} from '../../drizzle/schema/app-settings';
import type { SettingsService } from '../../settings/settings.service';
import { loadExpectedVoters } from './quorum-voters.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

const DEFAULT_MIN_NOMINATIONS = 4;
const DEFAULT_MIN_NOMINATIONS_PER_VOTER = 3;

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
  const expected = await loadExpectedVoters(db, lineup);
  if (expected.length < 2) {
    // Solo lineup (creator alone or no participants yet) — manual advance only.
    // Auto-advancing here would surprise the operator who's still setting up.
    return { ready: false, reason: 'solo lineup; manual advance required' };
  }
  const perVoterCounts = await countNominationsPerVoter(db, lineup.id);
  const minPerVoter = await readMinNominationsPerVoter(settings);
  const short = expected.filter(
    (id) => (perVoterCounts.get(id) ?? 0) < minPerVoter,
  );
  if (short.length > 0) {
    return {
      ready: false,
      reason: `${short.length} expected nominator(s) below ${minPerVoter} nominations`,
    };
  }
  const totalNominations = await countNominations(db, lineup.id);
  const floor = await readMinNominations(settings);
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
  const expected = await loadExpectedVoters(db, lineup);
  const perVoterCounts = await countVotesPerVoter(db, lineup.id);
  if (expected.length < 2) {
    // Solo lineup — manual advance only. Same reasoning as building quorum.
    return { ready: false, reason: 'solo lineup; manual advance required' };
  }
  const required = lineup.maxVotesPerPlayer ?? 3;
  const short = expected.filter(
    (id) => (perVoterCounts.get(id) ?? 0) < required,
  );
  if (short.length > 0) {
    return {
      ready: false,
      reason: `${short.length} expected voter(s) below ${required} votes`,
    };
  }
  return { ready: true };
}

async function countNominationsPerVoter(
  db: Db,
  lineupId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      userId: schema.communityLineupEntries.nominatedBy,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId))
    .groupBy(schema.communityLineupEntries.nominatedBy);
  return new Map(rows.map((r) => [r.userId, Number(r.count)]));
}

async function countVotesPerVoter(
  db: Db,
  lineupId: number,
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      userId: schema.communityLineupVotes.userId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineupId))
    .groupBy(schema.communityLineupVotes.userId);
  return new Map(rows.map((r) => [r.userId, Number(r.count)]));
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

async function readMinNominationsPerVoter(
  settings: SettingsService,
): Promise<number> {
  return readPositiveSetting(
    settings,
    SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS_PER_VOTER,
    DEFAULT_MIN_NOMINATIONS_PER_VOTER,
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
