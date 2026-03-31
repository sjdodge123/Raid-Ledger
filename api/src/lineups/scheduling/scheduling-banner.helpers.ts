/**
 * Banner helpers for the scheduling poll events-view banner (ROK-965).
 * Extracted from SchedulingService to stay under the 300-line file limit.
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SchedulingBannerDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  findScheduleSlots,
  findUserSchedulingMatches,
} from './scheduling-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** Find the active lineup in decided status. */
export async function findActiveDecidedLineup(db: Db) {
  const [lineup] = await db
    .select({ id: schema.communityLineups.id })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.status, 'decided'))
    .limit(1);
  return lineup ?? null;
}

/** Build the scheduling banner for a user's events page. */
export async function buildBannerForUser(
  db: Db,
  userId: number,
): Promise<SchedulingBannerDto | null> {
  const activeLineup = await findActiveDecidedLineup(db);
  if (!activeLineup) return null;

  const matches = await findUserSchedulingMatches(db, activeLineup.id, userId);
  if (matches.length === 0) return null;

  const polls = await Promise.all(
    matches.map(async (m) => {
      const slots = await findScheduleSlots(db, m.matchId);
      return {
        matchId: m.matchId,
        gameName: m.gameName,
        gameCoverUrl: m.gameCoverUrl,
        memberCount: m.memberCount,
        slotCount: slots.length,
      };
    }),
  );

  return { lineupId: activeLineup.id, polls };
}
