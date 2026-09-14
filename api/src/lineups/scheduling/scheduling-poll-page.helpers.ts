/**
 * Poll-page data loading for `SchedulingService.getSchedulePoll`.
 *
 * Lives in its own module rather than `scheduling-query.helpers` because it
 * composes queries from three helper modules — and `scheduling-event.helpers`
 * already imports `scheduling-query.helpers`, so putting it there would close
 * an import cycle.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { findMatchMembers } from '../lineups-match-query.helpers';
import { resolveGameInfo } from './scheduling-event.helpers';
import {
  findLineupPollMeta,
  findScheduleSlots,
  countUniqueVoters,
  findFollowupSourceEventId,
  findScheduleVotes,
} from './scheduling-query.helpers';
import { findSlotConflicts } from './scheduling-conflict.helpers';
import {
  buildPollResponse,
  deriveIsStandalone,
} from './scheduling-response.helpers';
import {
  resolvePollTerminalState,
  type PollLineupContext,
} from './scheduling-poll-state.helpers';

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

/**
 * Assemble the poll-page response from the loaded inputs (ROK-1545).
 *
 * Lives here rather than in the service so `getSchedulePoll` stays a guard
 * clause plus two calls — the terminal-state resolution added by ROK-1545
 * pushed `scheduling.service.ts` over the 300-line lint cap.
 *
 * @param db - Drizzle database handle.
 * @param inputs - The rows `loadSchedulePollInputs` returned.
 * @param userId - The authenticated viewer, or null when anonymous.
 * @param callerRole - The viewer's role, for the role-aware `canVote`.
 * @returns The full poll page response, terminal-state fields included.
 */
export async function assembleSchedulePollResponse(
  db: Db,
  inputs: {
    pollMatch: Parameters<typeof buildPollResponse>[0] & {
      status: string;
      linkedEventId: number | null;
      cancellationReason?: string | null;
    };
    lineup:
      | (PollLineupContext & {
          phaseDurationOverride?: unknown;
        })
      | undefined;
    members: Parameters<typeof buildPollResponse>[1];
    slots: Parameters<typeof buildPollResponse>[2];
    voterCount: number;
  },
  userId: number | null,
  callerRole: string | null,
): Promise<SchedulePollPageResponseDto> {
  const { pollMatch, lineup, members, slots, voterCount } = inputs;
  const votes = await findScheduleVotes(
    db,
    slots.map((s) => s.id),
  );
  const slotConflicts = userId
    ? await findSlotConflicts(db, userId, slots)
    : undefined;
  const terminal = await resolvePollTerminalState(
    db,
    pollMatch,
    lineup,
    slots,
    userId ? { id: userId, role: callerRole } : null,
  );
  return {
    ...terminal,
    ...buildPollResponse(
      pollMatch,
      members,
      slots,
      votes,
      userId,
      lineup?.status ?? 'decided',
      deriveIsStandalone(lineup?.phaseDurationOverride),
    ),
    uniqueVoterCount: voterCount,
    conflictingSlotIds: slotConflicts?.map((c) => c.slotId),
    slotConflicts,
    phaseDeadline: lineup?.phaseDeadline
      ? lineup.phaseDeadline.toISOString()
      : null,
  };
}
