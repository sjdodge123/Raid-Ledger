/**
 * `?lock=<slotId>` deep link (ROK-1604 AC2). The poll-expiry DM links here;
 * the hook opens the EXISTING lock-in confirm — never a direct commit — for a
 * viewer who may lock (`canBypassThreshold`), on an open poll, for a slot that
 * exists and is still in the future. Anything else is ignored with a toast.
 * The param is stripped (`replace: true`) after one read so a refresh never
 * re-opens it. Server guards (`assertCanCompletePoll`) stay authoritative.
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  SchedulePollPageResponseDto,
  ScheduleSlotWithVotesDto,
} from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import {
  canBypassThreshold,
  type ThresholdUser,
} from '../../../pages/scheduling/threshold';
import { resolvePollStatus } from './scheduling-poll-status';
import { POLL_CHANGED_MESSAGE, type SchedulingLock } from './use-scheduling-lock';

const LOCK_PARAM = 'lock';

export interface LockDeepLinkArgs {
  poll: SchedulePollPageResponseDto;
  lock: Pick<SchedulingLock, 'requestLock'>;
  user: ThresholdUser | null;
  /** While auth resolves, a null user is "unknown", not "signed out". */
  authLoading?: boolean;
}

/** The slot to open, or the toast explaining why the link is ignored. */
function resolveDeepLinkSlot(
  args: LockDeepLinkArgs,
  slotId: number,
): ScheduleSlotWithVotesDto | string {
  const { poll, user } = args;
  if (!canBypassThreshold(user, poll.match)) return "You can't lock in this poll";
  if (resolvePollStatus(poll) !== 'open') return "You can't lock in this poll";
  const slot = poll.slots.find((s) => s.id === slotId);
  if (!slot) return POLL_CHANGED_MESSAGE;
  if (new Date(slot.proposedTime) <= new Date()) return 'That time has passed';
  return slot;
}

/** Read `?lock=` once, open that slot's confirm or toast, strip the param. */
export function useLockDeepLink(args: LockDeepLinkArgs): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const handled = useRef(false);
  const raw = searchParams.get(LOCK_PARAM);
  const { poll, lock, user, authLoading } = args;

  useEffect(() => {
    if (raw === null || handled.current || authLoading) return;
    handled.current = true;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(LOCK_PARAM);
        return next;
      },
      { replace: true },
    );
    const target = resolveDeepLinkSlot({ poll, lock, user }, Number(raw));
    if (typeof target === 'string') {
      toast.error(target);
      return;
    }
    void lock.requestLock(target, { forceConfirm: true });
    // `handled` makes every later render a no-op, so object identity churn
    // in `lock`/`poll` cannot re-open the confirm.
  }, [raw, authLoading, poll, lock, user, setSearchParams]);
}
