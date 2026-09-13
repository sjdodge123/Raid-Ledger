/**
 * Mock poll states for the ROK-1540 scheduling-poll wireframes — DEV-ONLY.
 *
 * One state list drives all three candidate layouts so they can be compared
 * on identical data. Every state here maps to a row of the state matrix in
 * `docs/spikes/rok-1540-scheduling-poll-audit.md` §2. No API, no hooks.
 */

/** One proposed time in a mocked poll. */
export interface WfSlot {
  id: number;
  /** Weekday label, e.g. "Thu". */
  day: string;
  /** Time-of-day label, e.g. "8:00 PM". */
  time: string;
  /** Relative label used by the timeline layout, e.g. "in 2 days". */
  relative: string;
  votes: number;
  /** Display names behind the avatar stack. */
  voters: string[];
  /** Viewer has voted for this slot. */
  mine: boolean;
  /** Slot is in the past. */
  past?: boolean;
  /** Title of a conflicting event the viewer already signed up for. */
  conflict?: string;
}

/** A whole mocked poll in one of the audited states. */
export interface WfPoll {
  game: string;
  /** Poll lifecycle, matching the Discord author-line grammar (P-5). */
  status: 'open' | 'locked' | 'cancelled' | 'closed';
  slots: WfSlot[];
  /** Members enrolled in the poll. */
  members: number;
  /** Distinct members who voted at least once. */
  voters: number;
  /** Human deadline copy, null when the poll has no deadline. */
  deadline: string | null;
  /** Winning time copy, set when `status === 'locked'`. */
  lockedTime?: string;
  /** Operator's cancellation reason. */
  reason?: string;
  /** Viewer may cast a vote (false = read-only viewer, F-07). */
  canVote: boolean;
  /** Viewer joined after voting started (F-05 / P-6). */
  lateJoiner: boolean;
  /** Viewer already committed at least one vote. */
  hasVoted: boolean;
  /** Availability overlap per slot index, 0..1; empty = no data. */
  overlap: number[];
  /** One-line note explaining what this state is exercising. */
  note: string;
}

const VOTERS = ['Rok', 'Ash', 'Bex', 'Cy', 'Dana', 'Eli', 'Fen'];

/** Build the baseline three-slot poll every state starts from. */
function baseSlots(): WfSlot[] {
  return [
    { id: 1, day: 'Thu', time: '8:00 PM', relative: 'in 2 days', votes: 5, voters: VOTERS.slice(0, 5), mine: false },
    { id: 2, day: 'Fri', time: '9:00 PM', relative: 'in 3 days', votes: 3, voters: VOTERS.slice(1, 4), mine: false, conflict: 'Mythic+ Night' },
    { id: 3, day: 'Sat', time: '7:00 PM', relative: 'in 4 days', votes: 1, voters: VOTERS.slice(5, 6), mine: false },
  ];
}

/** Baseline open poll; each state below mutates a copy of this. */
function basePoll(): WfPoll {
  return {
    game: 'Helldivers 2',
    status: 'open',
    slots: baseSlots(),
    members: 9,
    voters: 6,
    deadline: 'closes Wed 11:59 PM',
    canVote: true,
    lateJoiner: false,
    hasVoted: false,
    overlap: [0.9, 0.55, 0.2],
    note: '',
  };
}

/** Identifier for a mocked state; the switcher renders these in order. */
export type WfStateId =
  | 'open-empty'
  | 'open-unvoted'
  | 'voted'
  | 'changed'
  | 'tie'
  | 'locked'
  | 'cancelled'
  | 'late-joiner'
  | 'read-only-viewer'
  | 'expired'
  | 'no-availability';

/** Ordered state list for the switcher. */
export const WF_STATES: { id: WfStateId; label: string }[] = [
  { id: 'open-empty', label: 'Open · no times yet' },
  { id: 'open-unvoted', label: 'Open · not voted' },
  { id: 'voted', label: 'Voted' },
  { id: 'changed', label: 'Changed vote' },
  { id: 'tie', label: 'Tie' },
  { id: 'locked', label: 'Locked in' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'late-joiner', label: 'Late joiner' },
  { id: 'read-only-viewer', label: 'Viewer · no vote rights' },
  { id: 'expired', label: 'Expired' },
  { id: 'no-availability', label: 'No availability data' },
];

/** Terminal / non-voting states (locked, cancelled, expired, viewer-only). */
function terminalPoll(state: WfStateId, p: WfPoll): WfPoll | null {
  switch (state) {
    case 'locked':
      return { ...p, status: 'locked', lockedTime: 'Thu 8:00 PM', hasVoted: true, slots: p.slots.map((s) => (s.id === 1 ? { ...s, mine: true } : s)), note: 'Locked in. The web page must name the winning time and link the event — today it says only "Voting is closed" (F-01).' };
    case 'cancelled':
      return { ...p, status: 'cancelled', reason: 'Half the roster is out for the holiday — will re-run next week.', note: 'Cancelled, with the operator reason the modal already collects but never renders (F-02).' };
    case 'read-only-viewer':
      return { ...p, canVote: false, note: 'Not a member. No live vote buttons that will only fail server-side (F-07).' };
    case 'expired':
      return { ...p, status: 'closed', deadline: 'closed Mon 11:59 PM', slots: p.slots.map((s) => ({ ...s, past: true })), note: 'Deadline passed with no lock-in. Past times are not votable, and the page says what happens next (F-04).' };
    default:
      return null;
  }
}

/** Resolve a mocked poll for a state id. Pure; safe to call in render. */
export function pollFor(state: WfStateId): WfPoll {
  const p = basePoll();
  const terminal = terminalPoll(state, p);
  if (terminal) return terminal;
  switch (state) {
    case 'open-empty':
      return { ...p, slots: [], voters: 0, overlap: [], note: 'Nobody has proposed a time. The empty state must still say when the poll closes and offer one obvious way to add a time.' };
    case 'voted': {
      const slots = p.slots.map((s) => (s.id === 1 ? { ...s, mine: true, votes: 6, voters: [...s.voters, 'You'] } : s));
      return { ...p, slots, voters: 7, hasVoted: true, note: 'Voted, no submit step. The page confirms in place; the counts move under you as others vote (P-3).' };
    }
    case 'changed': {
      const slots = p.slots.map((s) => (s.id === 2 ? { ...s, mine: true, votes: 4, voters: [...s.voters, 'You'] } : s));
      return { ...p, slots, voters: 7, hasVoted: true, note: 'Vote moved from Thu to Fri in one tap — no unlock, no re-submit (fixes F-06: 3 taps today).' };
    }
    case 'tie': {
      const slots = p.slots.map((s) => (s.id === 2 ? { ...s, votes: 5, voters: VOTERS.slice(0, 5) } : s));
      return { ...p, slots, voters: 7, note: 'Two slots at 5. Web and Discord must break the tie the same way — earliest time wins — and say so (F-03).' };
    }
    case 'late-joiner':
      return { ...p, lateJoiner: true, voters: 8, members: 9, deadline: 'closes in 22 minutes', note: 'Arrived at minute 50 of 60. Needs the leader, the gap, and the clock before anything else (P-6).' };
    case 'no-availability':
      return { ...p, overlap: [], note: 'No availability profiles yet — the ranked list still works; only the overlap column goes quiet (F-14).' };
    default:
      return { ...p, note: 'The common case. One tap on the leading row must be a complete vote (P-2).' };
  }
}

/** Status grammar shared with the Discord author line (P-5). */
export function statusLine(p: WfPoll): string {
  if (p.status === 'locked') return `● LOCKED IN · ${p.lockedTime ?? ''}`.trim();
  if (p.status === 'cancelled') return '■ POLL CANCELLED';
  if (p.status === 'closed') return '■ POLL CLOSED';
  return `▸ POLL OPEN · ${p.voters} of ${p.members} voted`;
}

/**
 * Leading slot by votes; ties broken by `id`.
 *
 * The real F-03 rule is "earliest `proposedTime` wins". `WfSlot` carries only
 * display strings (`day` / `time`), not a timestamp, so `id` stands in for it:
 * the mocks number their slots chronologically on purpose. A real
 * implementation must sort on `proposedTime` and keep `id` only as the final
 * stable key — do not copy this comparator verbatim.
 */
export function leader(p: WfPoll): WfSlot | null {
  if (p.slots.length === 0) return null;
  return [...p.slots].sort((a, b) => b.votes - a.votes || a.id - b.id)[0];
}

/** True when the top two slots are level on votes. */
export function isTied(p: WfPoll): boolean {
  if (p.slots.length < 2) return false;
  const sorted = [...p.slots].sort((a, b) => b.votes - a.votes);
  return sorted[0].votes === sorted[1].votes;
}
