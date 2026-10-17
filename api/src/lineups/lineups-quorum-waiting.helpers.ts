/**
 * ROK-1258 — "still waiting on" voters for the private-lineup quorum panel.
 * Extracted from `lineups-response.helpers.ts` (ROK-1314) to keep that file
 * under the 300-line cap.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { LineupInviteeResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';
import { loadQuorumGatingVoters } from './quorum/quorum-voters.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1258: Resolve the invitees currently blocking quorum — i.e. invitees
 * who are in the active quorum-gating set AND haven't met their full vote
 * allotment. Mirrors `loadQuorumGatingVoters`'s hybrid policy so the panel
 * never names invitees who have already been dropped post-deadline (which
 * would make the panel contradict the auto-advance state). Creator is
 * always excluded — the panel is about who else the creator is waiting on.
 *
 * Returns `[]` for any non-voting or non-private lineup, OR when nobody is
 * blocking quorum (either everyone has met their allotment or the gating
 * set has collapsed under the hybrid policy).
 */
export async function loadStillWaitingOnVoters(
  db: Db,
  lineup: typeof schema.communityLineups.$inferSelect,
  invitees: LineupInviteeResponseDto[],
): Promise<LineupInviteeResponseDto[]> {
  if (lineup.status !== 'voting' || lineup.visibility !== 'private') return [];
  if (invitees.length === 0) return [];
  const required = lineup.maxVotesPerPlayer ?? 3;
  const [gatingIds, voteRows] = await Promise.all([
    loadQuorumGatingVoters(db, lineup),
    db
      .select({
        userId: schema.communityLineupVotes.userId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.communityLineupVotes)
      .where(eq(schema.communityLineupVotes.lineupId, lineup.id))
      .groupBy(schema.communityLineupVotes.userId),
  ]);
  const gatingSet = new Set(gatingIds);
  const counts = new Map(voteRows.map((r) => [r.userId, Number(r.count)]));
  return invitees.filter(
    (invitee) =>
      invitee.id !== lineup.createdBy &&
      gatingSet.has(invitee.id) &&
      (counts.get(invitee.id) ?? 0) < required,
  );
}
