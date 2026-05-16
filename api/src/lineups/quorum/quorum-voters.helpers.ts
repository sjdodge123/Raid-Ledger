/**
 * Expected-voter resolution for lineup quorum checks (ROK-1118 / ROK-1258).
 *
 * Public lineups: every user who has actually participated — either
 *   nominated an entry or cast a vote. Creators don't gate quorum unless
 *   they participate, otherwise no public lineup could ever advance.
 * Private lineups: creator + invitee roster — these are the only people
 *   who CAN participate, so they're the gating set regardless of whether
 *   they have yet.
 *
 * `loadExpectedVoters` returns the FULL roster and is used by DM /
 * notification fan-out — do not narrow it. ROK-1258 introduced
 * `loadQuorumGatingVoters` as a parallel helper that applies the hybrid
 * "drop non-voters after deadline" policy ONLY for quorum gating.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type LineupRow = typeof schema.communityLineups.$inferSelect;

/** Resolve the set of users whose participation gates auto-advance. */
export async function loadExpectedVoters(
  db: Db,
  lineup: LineupRow,
): Promise<number[]> {
  if (lineup.visibility === 'private') {
    return loadPrivateExpectedVoters(db, lineup);
  }
  return loadPublicExpectedVoters(db, lineup.id);
}

/**
 * ROK-1258: Quorum-gating voter set. Identical to `loadExpectedVoters` for
 * public lineups. For private lineups, applies the hybrid voter-participation
 * policy: after the phase deadline has passed, drop invitees who have not
 * participated yet (no votes during voting, no nominations during building).
 * The creator is never dropped — solo creators still gate quorum.
 *
 * Deadline source by status:
 *   - voting   → `lineup.votingDeadline`
 *   - building → `lineup.phaseDeadline`
 *   - other    → no grace (callers don't quorum-gate other statuses).
 *
 * A NULL deadline disables the grace path — the only way to unblock such a
 * lineup is for the creator to remove non-voting invitees via the management
 * UI (which calls `DELETE /lineups/:id/invitees/:userId`).
 */
export async function loadQuorumGatingVoters(
  db: Db,
  lineup: LineupRow,
): Promise<number[]> {
  if (lineup.visibility !== 'private') {
    return loadPublicExpectedVoters(db, lineup.id);
  }
  const fullRoster = await loadPrivateExpectedVoters(db, lineup);
  const deadline = pickPhaseDeadline(lineup);
  if (deadline === null || Date.now() < deadline.getTime()) {
    return fullRoster;
  }
  const participants =
    lineup.status === 'voting'
      ? await findDistinctVoters(db, lineup.id)
      : await findDistinctNominators(db, lineup.id);
  const participantSet = new Set(participants);
  return fullRoster.filter(
    (userId) => userId === lineup.createdBy || participantSet.has(userId),
  );
}

function pickPhaseDeadline(lineup: LineupRow): Date | null {
  if (lineup.status === 'voting') return lineup.votingDeadline ?? null;
  if (lineup.status === 'building') return lineup.phaseDeadline ?? null;
  return null;
}

async function loadPublicExpectedVoters(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const [nominators, voters] = await Promise.all([
    findDistinctNominators(db, lineupId),
    findDistinctVoters(db, lineupId),
  ]);
  return Array.from(new Set([...nominators, ...voters]));
}

async function loadPrivateExpectedVoters(
  db: Db,
  lineup: LineupRow,
): Promise<number[]> {
  const invitees = await db
    .select({ userId: schema.communityLineupInvitees.userId })
    .from(schema.communityLineupInvitees)
    .where(eq(schema.communityLineupInvitees.lineupId, lineup.id));
  return Array.from(
    new Set([lineup.createdBy, ...invitees.map((r) => r.userId)]),
  );
}

async function findDistinctNominators(
  db: Db,
  lineupId: number,
): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.communityLineupEntries.nominatedBy })
    .from(schema.communityLineupEntries)
    .where(eq(schema.communityLineupEntries.lineupId, lineupId));
  return Array.from(new Set(rows.map((r) => r.userId)));
}

async function findDistinctVoters(db: Db, lineupId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: schema.communityLineupVotes.userId })
    .from(schema.communityLineupVotes)
    .where(eq(schema.communityLineupVotes.lineupId, lineupId));
  return Array.from(new Set(rows.map((r) => r.userId)));
}
