/**
 * Poll-page data loading for `SchedulingService.getSchedulePoll`.
 *
 * Lives in its own module rather than `scheduling-query.helpers` because it
 * composes queries from three helper modules — and `scheduling-event.helpers`
 * already imports `scheduling-query.helpers`, so putting it there would close
 * an import cycle.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { findMatchMembers } from '../lineups-match-query.helpers';
import { resolveGameInfo } from './scheduling-event.helpers';
import {
  findLineupPollMeta,
  findScheduleSlots,
  countUniqueVoters,
  findFollowupSourceEventId,
} from './scheduling-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Load every independent input the poll page needs in one parallel round and
 * fold the per-match metadata onto the match row, ready for
 * `buildPollResponse`. `followupForEventId` is the ended event behind a
 * post-event follow-up poll (null for ordinary polls) — it drives the
 * create-form prefill when the organizer locks a time in.
 */
export async function loadSchedulePollInputs<
  M extends { gameId: number; lineupId: number },
>(db: Db, match: M, matchId: number) {
  const [gameInfo, [lineup], members, slots, voterCount, followupForEventId] =
    await Promise.all([
      resolveGameInfo(db, match.gameId),
      findLineupPollMeta(db, match.lineupId),
      findMatchMembers(db, [matchId]),
      findScheduleSlots(db, matchId),
      countUniqueVoters(db, matchId),
      findFollowupSourceEventId(db, matchId),
    ]);
  const pollMatch = {
    ...match,
    ...gameInfo,
    lineupCreatedById: lineup?.createdBy ?? null,
    followupForEventId,
  };
  return { pollMatch, lineup, members, slots, voterCount };
}
