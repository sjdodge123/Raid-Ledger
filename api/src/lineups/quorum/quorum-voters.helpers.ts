/**
 * Expected-voter resolution for lineup quorum checks (ROK-1118).
 *
 * Public lineups: every user who has actually participated — either
 *   nominated an entry or cast a vote. Creators don't gate quorum unless
 *   they participate, otherwise no public lineup could ever advance.
 * Private lineups: creator + invitee roster — these are the only people
 *   who CAN participate, so they're the gating set regardless of whether
 *   they have yet.
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
