/**
 * Terminal-state resolution for the scheduling poll page (ROK-1545).
 *
 * The page used to render ONE "Voting is closed." banner for lock-in,
 * cancellation and expiry alike (audit F-01/F-02/F-04). These helpers give the
 * response the four fields the page needs to say what actually happened —
 * `pollStatus`, `lockedInTime`, `cancelReason`, `canVote` — deriving the
 * status from the SAME helper the Discord embed uses so the two surfaces
 * cannot disagree.
 */
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sortSchedulingSlots } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { SchedulingPollStatus } from '../../discord-bot/services/discord-embed-scheduling.types';
import { isInvitee } from '../lineups-eligibility.helpers';
import { pollStatusFromMatch } from './scheduling-poll-embed.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The four terminal-state fields added to the poll page response. */
export interface PollTerminalState {
  pollStatus: SchedulingPollStatus;
  lockedInTime: string | null;
  cancelReason: string | null;
  canVote: boolean;
}

/** Parent-lineup fields the resolution needs. */
export interface PollLineupContext {
  id: number;
  status?: string | null;
  visibility?: string | null;
  createdBy?: number | null;
  phaseDeadline?: Date | null;
}

/** Match fields the resolution needs. */
export interface PollMatchContext {
  status: string;
  linkedEventId: number | null;
  cancellationReason?: string | null;
}

/** Slot shape the winning-time fallback orders. */
interface OrderedSlot {
  id: number;
  proposedTime: Date;
}

/** A vote row, reduced to the only field the fallback needs. */
interface SlotVoteRef {
  slotId: number;
}

/**
 * Vote count per slot id (ROK-1545 review F3). The fallback used to hand
 * `sortSchedulingSlots` a flat `voteCount: 0`, which degenerates the shared
 * comparator to time-ascending — so a lock-in whose event row is gone named
 * the EARLIEST time instead of the winner.
 */
function countVotesBySlot(votes: SlotVoteRef[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const vote of votes) {
    counts.set(vote.slotId, (counts.get(vote.slotId) ?? 0) + 1);
  }
  return counts;
}

/**
 * ISO start time the lock-in selected. The linked event's start is the only
 * trustworthy value (lock-in is not required to pick the top-voted slot); the
 * shared comparator's winner is the fallback when the event row is gone.
 */
async function resolveLockedInTime(
  db: Db,
  match: PollMatchContext,
  slots: OrderedSlot[],
  votes: SlotVoteRef[],
): Promise<string | null> {
  if (match.linkedEventId) {
    // `events.duration` is a tsrange — its lower bound is the start time.
    const [event] = await db
      .select({ startTime: sql<string>`lower(${schema.events.duration})` })
      .from(schema.events)
      .where(eq(schema.events.id, match.linkedEventId))
      .limit(1);
    if (event?.startTime) return new Date(event.startTime).toISOString();
  }
  const counts = countVotesBySlot(votes);
  const [winner] = sortSchedulingSlots(
    slots.map((s) => ({
      id: s.id,
      proposedTime: s.proposedTime.toISOString(),
      voteCount: counts.get(s.id) ?? 0,
    })),
  );
  return winner?.proposedTime ?? null;
}

/**
 * Whether the viewer may cast a vote (audit F-07). A terminal poll and an
 * anonymous viewer are both false. On a PRIVATE lineup only the creator,
 * invitees and admins/operators qualify — everyone else would be rejected by
 * `assertCallerMayVote`, so the page renders no affordance. On a PUBLIC
 * lineup a non-member is true: voting self-enrols them, which is deliberate.
 */
async function resolveCanVote(
  db: Db,
  lineup: PollLineupContext | undefined,
  caller: { id: number; role?: string | null } | null,
  pollStatus: SchedulingPollStatus,
): Promise<boolean> {
  if (pollStatus !== 'open' || !caller) return false;
  if (!lineup || lineup.visibility !== 'private') return true;
  if (caller.role === 'admin' || caller.role === 'operator') return true;
  if (lineup.createdBy === caller.id) return true;
  return isInvitee(db, lineup.id, caller.id);
}

/**
 * Resolve every terminal-state field for the poll page in one call.
 *
 * @param db - Drizzle database handle.
 * @param match - The match row (status, linked event, cancellation reason).
 * @param lineup - The parent lineup row, when it was found.
 * @param slots - The match's slots, used for the winning-time fallback.
 * @param caller - The authenticated viewer, or null when anonymous.
 * @param votes - The slots' vote rows, so the fallback picks the LEADER.
 * @returns `pollStatus`, `lockedInTime`, `cancelReason` and `canVote`.
 */
export async function resolvePollTerminalState(
  db: Db,
  match: PollMatchContext,
  lineup: PollLineupContext | undefined,
  slots: OrderedSlot[],
  caller: { id: number; role?: string | null } | null,
  votes: SlotVoteRef[] = [],
): Promise<PollTerminalState> {
  const pollStatus = pollStatusFromMatch({
    matchStatus: match.status,
    lineupStatus: lineup?.status ?? null,
    phaseDeadline: lineup?.phaseDeadline ?? null,
    linkedEventId: match.linkedEventId,
  });
  const [lockedInTime, canVote] = await Promise.all([
    pollStatus === 'locked_in'
      ? resolveLockedInTime(db, match, slots, votes)
      : Promise.resolve(null),
    resolveCanVote(db, lineup, caller, pollStatus),
  ]);
  return {
    pollStatus,
    lockedInTime,
    cancelReason:
      pollStatus === 'cancelled' ? (match.cancellationReason ?? null) : null,
    canVote,
  };
}
