/**
 * Scheduling-mutation guards (ROK-1302).
 *
 * Extracted from SchedulingService to keep that file under the 300-line limit.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;

/** A match still accepts scheduling changes while suggested or scheduling. */
export function assertSchedulable(match: { status: string }): void {
  if (match.status !== 'scheduling' && match.status !== 'suggested') {
    throw new BadRequestException('This match is no longer accepting changes');
  }
}

/**
 * Refuse a scheduling action when the parent lineup opted out of the scheduling
 * phase. The decided matches stay `suggested` (so `assertSchedulable` alone
 * would let a hand-crafted matchId suggest a slot, auto-vote, and create an
 * event), so every scheduling mutation additionally verifies the PARENT lineup
 * still has scheduling enabled. 404s — the whole scheduling surface is "absent"
 * for opted-out lineups, matching `getSchedulePoll`.
 */
export async function assertSchedulingEnabled(
  db: Db,
  lineupId: number,
): Promise<void> {
  const [lineup] = await db
    .select({
      includeSchedulingPhase: schema.communityLineups.includeSchedulingPhase,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (lineup && lineup.includeSchedulingPhase === false) {
    throw new NotFoundException('Scheduling is disabled for this lineup');
  }
}
