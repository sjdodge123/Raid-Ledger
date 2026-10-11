/**
 * The poll page's side reads — availability heatmap + other polls — behind
 * the same private-poll view guard as the page (ROK-1750 review m3).
 *
 * Extracted from SchedulingService to keep that file under the 300-line limit.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AggregateGameTimeResponse,
  OtherPollsResponseDto,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { findMatchMembers } from '../lineups-match-query.helpers';
import { buildSchedulingAvailability } from './scheduling-availability.helpers';
import { findUserSchedulingMatches } from './scheduling-query.helpers';
import { assertCallerMayViewMatchPoll } from './scheduling-guard.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The signed-in caller of a side read. */
export interface SideReadViewer {
  id: number;
  role: string | null;
}

/**
 * Heatmap availability (fresh/stale/unknown) for a match's members.
 *
 * @param weekStart - Sunday 00:00 UTC of the week to paint (ROK-1570);
 *   `undefined` = the current week.
 * @throws NotFoundException when the viewer may not see a private poll.
 */
export async function loadMatchAvailability(
  db: Db,
  matchId: number,
  viewer: SideReadViewer,
  weekStart?: Date,
  tzOffset = 0,
): Promise<AggregateGameTimeResponse> {
  await assertCallerMayViewMatchPoll(db, matchId, viewer);
  const members = await findMatchMembers(db, [matchId]);
  return buildSchedulingAvailability(
    db,
    members.map((m) => m.userId),
    matchId,
    viewer.id,
    weekStart,
    tzOffset,
  );
}

/**
 * The viewer's other scheduling polls in the lineup.
 *
 * @throws NotFoundException when the viewer may not see a private poll.
 */
export async function loadOtherPolls(
  db: Db,
  lineupId: number,
  excludeMatchId: number,
  viewer: SideReadViewer,
): Promise<OtherPollsResponseDto> {
  await assertCallerMayViewMatchPoll(db, excludeMatchId, viewer);
  const matches = await findUserSchedulingMatches(db, lineupId, viewer.id);
  const polls = matches
    .filter((m) => m.matchId !== excludeMatchId)
    .map((m) => ({
      matchId: m.matchId,
      gameName: m.gameName,
      gameCoverUrl: m.gameCoverUrl,
      memberCount: m.memberCount,
    }));
  return { polls };
}
