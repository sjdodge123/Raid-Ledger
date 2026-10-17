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
import type { ScheduleVoteStance } from '@raid-ledger/contract';
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

/**
 * How recently a leader announcement must have fired for a vote announcement
 * to fold it in rather than replace it. The optimistic write and the
 * mutation's `onSuccess` are one network round-trip apart.
 */
const LEADER_MERGE_WINDOW_MS = 1500;

/** Return value of {@link useSchedulingAnnouncer}. */
export interface SchedulingAnnouncerState {
  /** Current live-region text; `''` when there is nothing to announce. */
  message: string;
  /**
   * Announce the viewer's own answer. Call from the toggle's SUCCESS path
   * only — a rolled-back vote must not be announced as saved.
   *
   * @param label - Formatted slot time, as rendered in the row.
   * @param stance - The answer the server now holds for this viewer: `'yes'`,
   *   `'no'` (ROK-1617's "doesn't work"), or `null` once it is cleared.
   */
  announceVote: (label: string, stance: ScheduleVoteStance | null) => void;
}

/**
 * The three answers as three sentences (ROK-1617 AC5).
 *
 * A NO used to reuse the withdrawal message, because the server's `voted`
 * flag is false for both — so the live region told a screen-reader user their
 * vote had been REMOVED at the exact moment they recorded a NO.
 */
function voteMessage(
  label: string,
  stance: ScheduleVoteStance | null,
): string {
  if (stance === 'yes') return `Your vote for ${label} is in.`;
  if (stance === 'no') return `You marked ${label} as not working for you.`;
  return `Your answer for ${label} was cleared.`;
}

/**
 * The card's own empty-state sentence, verbatim (review item 4).
 *
 * "A time was leading → no time works any more" is the single biggest change
 * the poll can make, and it is exactly what an anti-vote on the leading slot
 * causes. Sighted viewers watch the card flip to this sentence; the live
 * region used to say nothing at all, because the leader effect bailed out on
 * `!leader`. One sentence, one source — `SchedulingLeaderCard::NoLeaderBody`.
 */
const NO_LEADER_MESSAGE = 'No time works for the group yet.';

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
  /**
   * The most recent leader announcement and when it fired. A vote that flips
   * the lead announces the leader FIRST (the optimistic write re-derives it
   * before the mutation settles), and `announce` replaces the region's text —
   * so the vote message would clobber the one AC2 cares about most. Within
   * this window the two are read out together instead.
   */
  const lastLeaderMessage = useRef<{ text: string; at: number } | null>(null);

  const leaderId = leader?.slot.id ?? null;
  useEffect(() => {
    const previous = lastLeaderId.current;
    lastLeaderId.current = leaderId;
    // Mount is not a change, and a re-derived leader on the same slot is not
    // news — only an actual hand-over of the lead is announced.
    if (previous === undefined || previous === leaderId) return;
    const text = leader
      ? `${formatSlotTime(leader.slot.proposedTime).label} is now leading with ${pluraliseVotes(leader.votes)}.`
      : NO_LEADER_MESSAGE;
    lastLeaderMessage.current = { text, at: Date.now() };
    announce(text);
    // `leader` is read only when `leaderId` changed, which is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderId, announce]);

  const announceVote = useCallback(
    (label: string, stance: ScheduleVoteStance | null): void => {
      const vote = voteMessage(label, stance);
      const lead = lastLeaderMessage.current;
      const recentLead =
        lead && Date.now() - lead.at <= LEADER_MERGE_WINDOW_MS ? lead.text : null;
      lastLeaderMessage.current = null;
      announce(recentLead ? `${vote} ${recentLead}` : vote);
    },
    [announce],
  );

  return { message, announceVote };
}
