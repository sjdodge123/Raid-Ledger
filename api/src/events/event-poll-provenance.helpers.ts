/**
 * ROK-1844 — validate a client-supplied `CreateEventDto.schedulingMatchId`
 * before it is persisted as `events.created_from_poll_id`.
 *
 * That column is the provenance the poll-completion guard trusts to sign a
 * poll's yes-voters onto an event, so a forged value would let a creator tag
 * an unrelated event (another game, someone else's poll) as "from this poll".
 * A bad value is a 400 naming the reason — it is never silently dropped.
 */
import { BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { CreateEventDto } from '@raid-ledger/contract';

type Db = PostgresJsDatabase<typeof schema>;

/** Who is creating the event. */
export interface EventCreator {
  id: number;
  isStaff: boolean;
}

/** The poll facts the provenance check compares against. */
interface PollFacts {
  gameId: number;
  status: string;
  ownerId: number;
}

/** Fetch a match's game, status and owner (its lineup's creator), or null. */
async function fetchPollFacts(
  db: Db,
  matchId: number,
): Promise<PollFacts | null> {
  const [row] = await db
    .select({
      gameId: schema.communityLineupMatches.gameId,
      status: schema.communityLineupMatches.status,
      ownerId: schema.communityLineups.createdBy,
    })
    .from(schema.communityLineupMatches)
    .innerJoin(
      schema.communityLineups,
      eq(schema.communityLineups.id, schema.communityLineupMatches.lineupId),
    )
    .where(eq(schema.communityLineupMatches.id, matchId))
    .limit(1);
  return row ?? null;
}

/** The reason `facts` cannot back this event, or null when it can. */
function rejectionReason(
  facts: PollFacts | null,
  dto: CreateEventDto,
  creator: EventCreator,
): string | null {
  if (!facts) return 'schedulingMatchId: poll not found';
  if (!creator.isStaff && facts.ownerId !== creator.id) {
    return 'schedulingMatchId: you can only create an event from your own poll';
  }
  if (facts.status !== 'scheduling') {
    return 'schedulingMatchId: the poll is no longer open';
  }
  if (dto.gameId !== facts.gameId) {
    return "schedulingMatchId: the event's game must match the poll's game";
  }
  return null;
}

/**
 * Throws 400 unless `dto.schedulingMatchId` (when present) names an open poll
 * the creator owns (or the creator is staff) for the event's own game.
 */
export async function assertSchedulingMatchUsable(
  db: Db,
  dto: CreateEventDto,
  creator: EventCreator,
): Promise<void> {
  if (dto.schedulingMatchId === undefined) return;
  const facts = await fetchPollFacts(db, dto.schedulingMatchId);
  const reason = rejectionReason(facts, dto, creator);
  if (reason) throw new BadRequestException(reason);
}
