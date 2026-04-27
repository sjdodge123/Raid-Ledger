/**
 * Quorum predicates for lineup auto-advance (ROK-1118).
 *
 * Building quorum: every expected voter has nominated ≥1 entry AND
 *   total distinct nominations ≥ floor (settings, default 4).
 * Voting quorum: every expected voter has cast ≥1 vote.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { SETTING_KEYS } from '../../drizzle/schema/app-settings';
import type { SettingsService } from '../../settings/settings.service';
import { loadExpectedVoters } from './quorum-voters.helpers';

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
  const [expected, nominators, totalNominations, floor] = await Promise.all([
    loadExpectedVoters(db, lineup),
    loadDistinctNominatorIds(db, lineup.id),
    countNominations(db, lineup.id),
    readMinNominations(settings),
  ]);
  if (expected.length === 0) {
    return { ready: false, reason: 'no expected voters' };
  }
  const nominatorSet = new Set(nominators);
  const missing = expected.filter((id) => !nominatorSet.has(id));
  if (missing.length > 0) {
    return {
      ready: false,
      reason: `${missing.length} expected nominator(s) missing`,
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
  const [expected, voters] = await Promise.all([
    loadExpectedVoters(db, lineup),
    loadDistinctVoterIds(db, lineup.id),
  ]);
  if (expected.length === 0) {
    return { ready: false, reason: 'no expected voters' };
  }
  const voterSet = new Set(voters);
  const missing = expected.filter((id) => !voterSet.has(id));
  if (missing.length > 0) {
    return {
      ready: false,
      reason: `${missing.length} expected voter(s) missing`,
    };
  }
  return { ready: true };
}

async function loadDistinctNominatorIds(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.communityLineupEntries.nominatedBy })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return Array.from(new Set(rows.map((r) => r.userId)));
}

async function loadDistinctVoterIds(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.communityLineupVotes.userId })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineupId));
  return Array.from(new Set(rows.map((r) => r.userId)));
}

async function countNominations(db: Db, lineupId: number): Promise<number> {
  const rows = await db
    .select({ id: schema.communityLineupEntries.id })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return rows.length;
}

async function readMinNominations(settings: SettingsService): Promise<number> {
  const raw = await settings.get(
    SETTING_KEYS.LINEUP_AUTO_ADVANCE_MIN_NOMINATIONS,
  );
  if (!raw) return DEFAULT_MIN_NOMINATIONS;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed < 1 ? DEFAULT_MIN_NOMINATIONS : parsed;
}
