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

/**
 * One row per slot — every slot, never a top-3 truncation.
 *
 * Deliberately carries NO viewer state. This is the one shared message the
 * whole channel reads, so a `✓ you` here would be one member's vote shown to
 * everyone; the tick belongs in the ephemeral reply (F-16). `past` is a
 * property of the time, not of the reader, so it stays.
 */
function slotLines(p: WfPoll): EmbedLine[] {
  return targetSortedSlots(p).map((s) => ({
    id: `slot-${s.id}`,
    text: `${s.day} ${s.time} — ${s.votes} of ${p.members}${s.past ? '  · past' : ''}`,
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
    // slots + suggest would exceed DISCORD_ROW_LIMIT — degrade to a select.
    return [{ id: 'vote', label: 'Vote ▾', style: 'primary' }, suggest];
  }
  const slots = targetSortedSlots(p).map<EmbedButton>((s) => ({
    id: `slot-${s.id}`,
    label: `${s.day} ${s.time.replace(':00', '')}`,
    style: 'primary',
  }));
  return [...slots, suggest];
}

/**
 * The ephemeral reply a button press opens — the ONLY per-viewer surface
 * (F-16). Everything that depends on who is reading is here: the viewer's own
 * vote, the late-joiner catch-up, and the non-member's answer.
 *
 * A non-member still gets a reply: per the audit's AC4, a press on a PUBLIC
 * lineup self-enrols (`ensureMatchMember`) rather than being refused, so the
 * shared row keeps its button and the ephemeral says what the press will do.
 */
export function targetEphemeral(p: WfPoll): EphemeralModel | null {
  if (p.status !== 'open') return null;
  const mine = p.slots.filter((s) => s.mine);
  const top = leader(p);
  const lines: EmbedLine[] = [];
  if (!p.canVote) {
    lines.push({ id: 'join', text: 'You are not in this poll yet — voting adds you to it.', tone: 'warn' });
  } else {
    lines.push(
      mine.length === 0
        ? { id: 'mine', text: 'You have not voted yet.', tone: 'warn' }
        : { id: 'mine', text: `Your vote: ${mine.map((s) => `${s.day} ${s.time}`).join(', ')}`, tone: 'mine' },
    );
  }
  if (p.lateJoiner) {
    lines.push({ id: 'late', text: 'You joined late — here is where the group is at.', tone: 'warn' });
  }
  if (top) lines.push({ id: 'lead', text: `Leading: ${top.day} ${top.time} · ${top.votes} of ${p.members}`, tone: 'muted' });
  if (p.deadline) lines.push({ id: 'deadline', text: p.deadline, tone: 'muted' });
  return {
    headline: p.canVote ? 'Your vote in this poll' : 'Join this poll',
    lines,
    buttons: [
      { id: 'change', label: mine.length === 0 ? 'Pick a time' : 'Change my vote', style: 'primary' },
      { id: 'clear', label: 'Clear my votes', style: 'secondary', disabled: mine.length === 0 },
    ],
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
  'vs a single `Vote ▾` that opens a select. ' +
  'Buttons keep the one-tap vote (P-2); a select is the only shape that survives past 5 slots. Operator ruling needed — ' +
  'and P4-1 REVERSES ROK-1461, which deliberately removed this action row, so it is gated on P2-3’s `source` data.';

/** Per-state rationale for the Target column — names the findings it fixes. */
export const STATE_RATIONALE: Record<string, string> = {
  'open-empty': 'Empty state still carries the deadline (F-04) and one obvious way in — today it says only "No times suggested yet."',
  'open-unvoted': 'Leader first, all slots, deadline, and a vote castable without leaving Discord (F-17, F-04, P-1).',
  voted: 'The shared message still cannot say "you voted" — the ephemeral reply does (F-16).',
  changed: 'Changing a vote is one button press in the ephemeral, matching the web page’s one tap (F-06).',
  tie: 'Both surfaces order votes desc then earliest time, and the embed says so out loud (F-03).',
  locked: 'Names the winning time AND links the created event; the action row is gone (F-01, P-5).',
  cancelled: 'The cancellation reason reaches Discord instead of rendering as `■ POLL CLOSED` (F-02).',
  'late-joiner': 'Catch-up lands in the ephemeral, where per-viewer state belongs — the shared body stays generic (P-6, F-05).',
  'read-only-viewer': 'The shared row cannot be disabled per viewer, so the press self-enrols (audit AC4) and the ephemeral says so (F-07).',
  expired: 'Expired is distinguishable from cancelled and from locked-in, and the deadline explains why (F-02, F-04).',
  'no-availability': 'Availability never reached the embed anyway — the ranked list is unaffected (F-14).',
};
