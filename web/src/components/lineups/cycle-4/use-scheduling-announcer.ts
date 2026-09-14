/**
 * Polite live-region state for the scheduling poll (ROK-1546 AC2).
 *
 * The poll mutates in place: the viewer's vote is written optimistically and
 * the leading slot can flip as other members vote. Sighted users see both
 * changes; screen-reader users were told neither, because nothing on the page
 * is a live region. This hook owns the two announcements that matter and
 * nothing else — noise in a live region is worse than silence.
 *
 * Kept out of `SchedulingComposite` on purpose: the composite is already at
 * the 300-line cap, and the timing/ref bookkeeping here is the part worth
 * unit-testing on its own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SchedulingLeader } from './scheduling-leader';
import { formatSlotTime } from './scheduling-slot-time';

/**
 * How long an announcement stays in the region before it is cleared.
 *
 * Clearing matters for repetition: assistive tech only announces a CHANGE to
 * the region's text, so voting twice for the same slot would be silent the
 * second time if the first message were left in place.
 */
const ANNOUNCEMENT_TTL_MS = 4000;

/** Return value of {@link useSchedulingAnnouncer}. */
export interface SchedulingAnnouncerState {
  /** Current live-region text; `''` when there is nothing to announce. */
  message: string;
  /**
   * Announce the viewer's own vote. Call from the toggle's SUCCESS path only
   * — a rolled-back vote must not be announced as saved.
   *
   * @param label - Formatted slot time, as rendered in the row.
   * @param voted - True when the vote was cast, false when it was withdrawn.
   */
  announceVote: (label: string, voted: boolean) => void;
}

/** "3 votes" / "1 vote". */
function pluraliseVotes(votes: number): string {
  return votes === 1 ? '1 vote' : `${votes} votes`;
}

/** Message state that empties itself after {@link ANNOUNCEMENT_TTL_MS}. */
function useTransientMessage(): {
  message: string;
  announce: (next: string) => void;
} {
  const [message, setMessage] = useState('');
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((next: string): void => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setMessage(next);
    clearTimer.current = setTimeout(() => setMessage(''), ANNOUNCEMENT_TTL_MS);
  }, []);

  useEffect(
    () => () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    },
    [],
  );

  return { message, announce };
}

/**
 * Polite announcements for the scheduling poll — see file-level docstring.
 *
 * @param leader - The currently leading slot, or `null` when none is proposed.
 */
export function useSchedulingAnnouncer(
  leader: SchedulingLeader | null,
): SchedulingAnnouncerState {
  const { message, announce } = useTransientMessage();
  /** Last leader id we have seen. `undefined` until the first render lands. */
  const lastLeaderId = useRef<number | null | undefined>(undefined);

  const leaderId = leader?.slot.id ?? null;
  useEffect(() => {
    const previous = lastLeaderId.current;
    lastLeaderId.current = leaderId;
    // Mount is not a change, and a re-derived leader on the same slot is not
    // news — only an actual hand-over of the lead is announced.
    if (previous === undefined || previous === leaderId || !leader) return;
    const { label } = formatSlotTime(leader.slot.proposedTime);
    announce(`${label} is now leading with ${pluraliseVotes(leader.votes)}.`);
    // `leader` is read only when `leaderId` changed, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderId, announce]);

  const announceVote = useCallback(
    (label: string, voted: boolean): void => {
      announce(
        voted
          ? `Your vote for ${label} is in.`
          : `Your vote for ${label} was removed.`,
      );
    },
    [announce],
  );

  return { message, announceVote };
}
