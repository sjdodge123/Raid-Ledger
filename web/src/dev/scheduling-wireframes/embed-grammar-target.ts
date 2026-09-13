/**
 * TARGET scheduling-poll embed grammar for the ROK-1553 wireframe —
 * DEV-ONLY, pure. This is what the embed says AFTER audit items P2-2 and
 * P4-1 land (`docs/spikes/rok-1540-scheduling-poll-audit.md`).
 *
 * It mirrors Layout B (leader card + counts) so Discord and the web tell the
 * same story (P-5):
 *
 * - ONE status helper, four states — `OPEN · n of m voted`,
 *   `LOCKED IN · <time>`, `POLL CANCELLED · <reason>` (F-02),
 *   `EXPIRED · no lock-in`. `SchedulingPollStatus` gains `'cancelled'`.
 * - Leader-first line, the same sentence Layout B's decision card leads with.
 * - Votes are APPROVAL votes (unique key `(slot_id, user_id)`): a member marks
 *   every time they can make, so the copy is plural everywhere and the slot
 *   buttons are TOGGLES — a second press withdraws that one vote.
 * - Personal state is NOT delivered by an ephemeral (operator ruling: an
 *   ephemeral gets lost in the chat). Each slot line names its voters, so a
 *   reader finds their own name on the message everyone already sees — which
 *   is what the web page does with voter avatars, and what finally renders
 *   the `voterNames` the audit found computed-but-unrendered (F-15). A tap
 *   edits the message itself (P2-2's debounced sync): the new count and name
 *   ARE the confirmation. Ephemerals survive only for refusals and errors.
 * - Every slot, ordered votes desc then time asc — the shared comparator that
 *   P2-1 gives all three call sites (F-03). NO viewer state in the body: one
 *   shared message cannot personalise, so "did I vote?" lives in the
 *   ephemeral reply (F-16) and nowhere else.
 * - The deadline (F-04), a late-joiner catch-up line (P-6), a masked
 *   `Open on the web ↗`, and the P4-1 action row + ephemeral reply (F-16/F-17).
 */
import { EMBED_COLOR, type EmbedButton, type EmbedLine, type EphemeralModel, type WfEmbedModel } from './embed-model';
import { leader, isTied, type WfPoll, type WfSlot } from './wireframe-states';

/** Discord renders at most five components in one action row. */
const DISCORD_ROW_LIMIT = 5;

/**
 * Slot buttons cap at FOUR, not five: `+ Suggest a time` always occupies the
 * last component of the row, so a five-slot poll already overflows it.
 */
export const MAX_SLOT_BUTTONS = DISCORD_ROW_LIMIT - 1;

/** Shared comparator: votes desc, then earliest time. `id` stands in for `proposedTime`. */
export function targetSortedSlots(p: WfPoll): WfSlot[] {
  return [...p.slots].sort((a, b) => b.votes - a.votes || a.id - b.id);
}

/** The ONE status helper the web page and the embed both call (P-5). */
export function targetStatusLine(p: WfPoll): string {
  if (p.status === 'locked') return `● LOCKED IN · ${p.lockedTime ?? ''}`.trim();
  if (p.status === 'cancelled') return `■ POLL CANCELLED · ${p.reason ?? 'no reason given'}`;
  if (p.status === 'closed') return '■ EXPIRED · no lock-in';
  return `▸ OPEN · ${p.voters} of ${p.members} voted`;
}

/** The answer line — the embed's version of Layout B's decision card. */
function headlineLines(p: WfPoll): EmbedLine[] {
  const top = leader(p);
  if (p.status === 'locked') {
    return [
      { id: 'lead', text: `Locked in: ${p.lockedTime}`, tone: 'lead' },
      { id: 'event', text: 'The event is on the calendar — open it ↗', tone: 'mine' },
    ];
  }
  if (p.status === 'cancelled') {
    return [
      { id: 'lead', text: 'This poll was cancelled.', tone: 'lead' },
      { id: 'reason', text: `“${p.reason}”`, tone: 'bad' },
      { id: 'next', text: 'Nothing more to do — a re-run would be announced here.', tone: 'muted' },
    ];
  }
  if (!top) {
    return [{ id: 'lead', text: 'No times proposed yet — put one up.', tone: 'lead' }];
  }
  const verb = p.status === 'closed' ? 'Finished ahead' : 'Leading';
  return [{ id: 'lead', text: `${verb}: ${top.day} ${top.time} · ${top.votes} of ${p.members} voted`, tone: 'lead' }];
}

/** Names shown per slot before the rest collapse into `+N more`. */
const MAX_VOTER_NAMES = 4;

/**
 * Voter names for one slot, truncated so a field stays inside Discord's
 * 1024-character limit (the whole embed is capped at 6000).
 *
 * KNOWN TRADE-OFF, and the one the operator has to weigh: the list is the
 * same for every reader — it has to be, it is one message — so a member whose
 * name falls past the cut cannot find themselves on a popular slot. Ordering
 * the names per viewer is exactly the personalisation Discord cannot do.
 */
function voterNames(s: WfSlot): string {
  if (s.voters.length === 0) return 'nobody yet';
  const shown = s.voters.slice(0, MAX_VOTER_NAMES).join(', ');
  const rest = s.voters.length - MAX_VOTER_NAMES;
  return rest > 0 ? `${shown}, +${rest} more` : shown;
}

/**
 * One row per slot — every slot, never a top-3 truncation, each naming who
 * voted for it (F-15).
 *
 * The names are the same for every reader: this is the one shared message the
 * whole channel sees, so it addresses nobody in particular and a viewer finds
 * themselves by their own name. That is the operator's ruling — an ephemeral
 * carrying "your vote" gets lost in the chat, a name on the message does not.
 * `past` is a property of the time, not of the reader, so it stays.
 */
function slotLines(p: WfPoll): EmbedLine[] {
  return targetSortedSlots(p).map((s) => ({
    id: `slot-${s.id}`,
    text: `${s.day} ${s.time} · ${s.votes} ✓ — ${voterNames(s)}${s.past ? '  · past' : ''}`,
    tone: s.past ? 'muted' : 'normal',
  }));
}

/**
 * Deadline and tiebreak context — the lines today has none of.
 *
 * Both are properties of the POLL, so they belong in the shared body. The
 * late-joiner catch-up and the "you are not in this poll" refusal are
 * properties of the READER and live in the ephemeral reply instead.
 */
function contextLines(p: WfPoll): EmbedLine[] {
  const out: EmbedLine[] = [];
  if (isTied(p) && p.status === 'open') {
    out.push({ id: 'tie', text: 'Tied — the earliest time wins.', tone: 'warn' });
  }
  if (p.deadline) out.push({ id: 'deadline', text: `⏱ ${p.deadline}`, tone: 'muted' });
  if (p.status === 'open' && p.slots.length > 0) {
    // Approval voting stated in the shared body — every member may mark more
    // than one time, and a second press withdraws that vote.
    out.push({ id: 'howto', text: 'Tap every time that works — tap again to withdraw. The message updates in place.', tone: 'muted' });
  }
  return out;
}

/**
 * P4-1's action row. One button per slot while the slot buttons plus
 * `+ Suggest a time` still fit Discord's five-per-row limit (so ≤4 slots),
 * otherwise a single `Vote ▾` that opens a select — see
 * `TARGET_OPEN_QUESTION`.
 *
 * The row hangs off the SHARED message, so it is identical for every reader:
 * no per-viewer label, style or `disabled`. Discord has no per-viewer
 * component state, which means F-07 ("no affordance that only fails
 * server-side") is only answerable in the ephemeral reply — the press is
 * always allowed, the ephemeral says what it did.
 */
export function targetActionRow(p: WfPoll): EmbedButton[] | null {
  if (p.status !== 'open') return null;
  const suggest: EmbedButton = { id: 'suggest', label: '+ Suggest a time', style: 'secondary' };
  if (p.slots.length === 0) return [suggest];
  if (p.slots.length > MAX_SLOT_BUTTONS) {
    // slots + suggest would exceed DISCORD_ROW_LIMIT — degrade to a MULTI
    // select (`min_values: 0`, `max_values: slots.length`), because approval
    // voting means a member picks any number of times, including none.
    return [{ id: 'vote', label: 'Vote ▾ (pick any number)', style: 'primary' }, suggest];
  }
  const slots = targetSortedSlots(p).map<EmbedButton>((s) => ({
    id: `slot-${s.id}`,
    label: `${s.day} ${s.time.replace(':00', '')}`,
    style: 'primary',
  }));
  return [...slots, suggest];
}

/**
 * Ephemerals are for REFUSALS AND ERRORS ONLY (operator ruling).
 *
 * Nothing about a successful vote arrives this way: an ephemeral gets lost in
 * the chat, and the edited message — new count, new name — is the
 * confirmation. What is left is the handful of presses that cannot succeed:
 * a non-member on a private lineup, a poll that closed under the reader, a
 * rate limit. Those have to say something, and they must not be shouted at
 * the whole channel.
 */
export function targetEphemeral(p: WfPoll): EphemeralModel | null {
  if (p.canVote) return null;
  return {
    headline: 'Only you can see this — you are not in this poll',
    lines: [
      { id: 'why', text: 'This lineup is private, so the vote was not recorded.', tone: 'bad' },
      { id: 'next', text: 'Ask the organiser to add you and the buttons will work.', tone: 'muted' },
      { id: 'scope', text: 'Errors only: a vote that works edits the message above instead.', tone: 'muted' },
    ],
    buttons: [{ id: 'dismiss', label: 'Dismiss', style: 'secondary' }],
  };
}

/** The whole target embed for one mocked state. */
export function targetEmbed(p: WfPoll): WfEmbedModel {
  const color = p.status === 'locked'
    ? EMBED_COLOR.locked
    : p.status === 'cancelled'
      ? EMBED_COLOR.cancelled
      : p.status === 'closed'
        ? EMBED_COLOR.closed
        : EMBED_COLOR.open;
  return {
    color,
    authorLine: targetStatusLine(p),
    title: `When should we play ${p.game}?`,
    lines: [...headlineLines(p), ...slotLines(p), ...contextLines(p)],
    link: { label: 'Open on the web ↗', href: '/community-lineup/1/schedule/1' },
    footer: 'Raid Ledger · Scheduling Poll',
    actionRow: targetActionRow(p),
    ephemeral: targetEphemeral(p),
  };
}

/**
 * The one thing P4-1 must settle before it is filed.
 *
 * This wireframe picks **one button per slot**: every mocked poll has three
 * slots, one tap is one vote (P-2), and a select costs two interactions —
 * open, then choose — which is exactly the tax P-2 removes from the web page.
 * The select earns its place as soon as the row is full: Discord allows five
 * components and `+ Suggest a time` takes one of them, so `targetActionRow`
 * falls back to a single `Vote ▾` above FOUR slots. The operator has to rule
 * on which shape ships, because it decides whether a 5-slot poll degrades to
 * a select or grows a second row.
 */
export const TARGET_OPEN_QUESTION =
  'P4-1 open question: one button per slot (shown here, ≤4 slots — the fifth component of the row is `+ Suggest a time`) ' +
  'vs a single `Vote ▾` that opens a MULTI-select (`min_values: 0`, `max_values: <slot count>`; votes are approval votes, ' +
  'so a member marks any number of times). Buttons keep the one-tap vote (P-2); the multi-select is the only shape that ' +
  'survives past five components, which is also roughly where the embed-length budget bites: 1024 characters per field and ' +
  '6000 across the embed, which is what forces the `+N more` truncation on the voter names. ' +
  'Settled by the operator: NO ephemeral for state — it gets lost in chat, so the voters’ names go on the shared embed and ' +
  'a tap edits that message in place; ephemerals are kept for refusals and errors only. Consequence to weigh: on a slot with ' +
  'more than four voters the reader’s own name may sit behind `+N more`, and the order cannot be personalised, so the ' +
  'confirmation is weaker exactly where a poll is most popular. Still open — and P4-1 REVERSES ' +
  'ROK-1461, which deliberately removed this action row, so it stays gated on P2-3’s `source` data.';

/** Per-state rationale for the Target column — names the findings it fixes. */
export const STATE_RATIONALE: Record<string, string> = {
  'open-empty': 'Empty state still carries the deadline (F-04) and one obvious way in — today it says only "No times suggested yet."',
  'open-unvoted': 'Leader first, all slots, deadline, and a vote castable without leaving Discord (F-17, F-04, P-1).',
  voted: 'Two times marked — approval voting. No ephemeral: the reader finds their own name under each slot they voted for (F-15, F-16).',
  changed: 'Withdrawing is a second press on the same button; the message edits in place, name and count together (F-06).',
  tie: 'Both surfaces order votes desc then earliest time, and the embed says so out loud (F-03).',
  locked: 'Names the winning time AND links the created event; the action row is gone (F-01, P-5).',
  cancelled: 'The cancellation reason reaches Discord instead of rendering as `■ POLL CLOSED` (F-02).',
  'late-joiner': 'Catch-up lands in the ephemeral, where per-viewer state belongs — the shared body stays generic (P-6, F-05).',
  'read-only-viewer': 'The only state with an ephemeral: refusals and errors, never confirmations. The shared row cannot be disabled per viewer (F-07).',
  expired: 'Expired is distinguishable from cancelled and from locked-in, and the deadline explains why (F-02, F-04).',
  'no-availability': 'Availability never reached the embed anyway — the ranked list is unaffected (F-14).',
};
