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
 *   P2-1 gives all three call sites (F-03) — with the viewer's own tick.
 * - The deadline (F-04), a late-joiner catch-up line (P-6), a masked
 *   `Open on the web ↗`, and the P4-1 action row + ephemeral reply (F-16/F-17).
 */
import { EMBED_COLOR, type EmbedButton, type EmbedLine, type EphemeralModel, type WfEmbedModel } from './embed-model';
import { leader, isTied, type WfPoll, type WfSlot } from './wireframe-states';

/** Buttons-per-slot is only offered up to Discord's 5-per-row limit. */
export const MAX_SLOT_BUTTONS = 5;

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
      { id: 'event', text: 'You are signed up — open the event ↗', tone: 'mine' },
    ];
  }
  if (p.status === 'cancelled') {
    return [
      { id: 'lead', text: 'This poll was cancelled.', tone: 'lead' },
      { id: 'reason', text: `“${p.reason}”`, tone: 'bad' },
      { id: 'next', text: 'Nothing to do here — you will be DM’d if it re-runs.', tone: 'muted' },
    ];
  }
  if (!top) {
    return [{ id: 'lead', text: 'No times proposed yet — put one up.', tone: 'lead' }];
  }
  const verb = p.status === 'closed' ? 'Finished ahead' : 'Leading';
  return [{ id: 'lead', text: `${verb}: ${top.day} ${top.time} · ${top.votes} of ${p.members} voted`, tone: 'lead' }];
}

/** One row per slot, with the viewer's own tick — never a top-3 truncation. */
function slotLines(p: WfPoll): EmbedLine[] {
  return targetSortedSlots(p).map((s) => ({
    id: `slot-${s.id}`,
    text: `${s.day} ${s.time} — ${s.votes} of ${p.members}${s.mine ? '  ✓ you' : ''}${s.past ? '  · past' : ''}`,
    tone: s.mine ? 'mine' : s.past ? 'muted' : 'normal',
  }));
}

/** Deadline, tiebreak and late-joiner context — the lines today has none of. */
function contextLines(p: WfPoll): EmbedLine[] {
  const out: EmbedLine[] = [];
  if (isTied(p) && p.status === 'open') {
    out.push({ id: 'tie', text: 'Tied — the earliest time wins.', tone: 'warn' });
  }
  if (p.deadline) out.push({ id: 'deadline', text: `⏱ ${p.deadline}`, tone: 'muted' });
  if (p.lateJoiner) {
    out.push({ id: 'late', text: 'You joined late — here is where the group is at.', tone: 'warn' });
  }
  if (!p.canVote) {
    out.push({ id: 'readonly', text: 'You are not in this poll — ask the organiser to add you.', tone: 'muted' });
  }
  return out;
}

/**
 * P4-1's action row. One button per slot while the poll has ≤5 of them,
 * otherwise a single `Vote` that opens a select — see `TARGET_OPEN_QUESTION`.
 * Rendered disabled for a viewer with no vote rights so no button exists that
 * will only fail server-side (F-07).
 */
export function targetActionRow(p: WfPoll): EmbedButton[] | null {
  if (p.status !== 'open') return null;
  const disabled = !p.canVote;
  const suggest: EmbedButton = { id: 'suggest', label: '+ Suggest a time', style: 'secondary', disabled };
  if (p.slots.length === 0) return [suggest];
  if (p.slots.length > MAX_SLOT_BUTTONS) {
    return [{ id: 'vote', label: 'Vote ▾', style: 'primary', disabled }, suggest];
  }
  const slots = targetSortedSlots(p).map<EmbedButton>((s) => ({
    id: `slot-${s.id}`,
    label: `${s.day} ${s.time.replace(':00', '')}${s.mine ? ' ✓' : ''}`,
    style: s.mine ? 'success' : 'primary',
    disabled,
  }));
  return [...slots, suggest];
}

/** The ephemeral reply a vote button opens — per-viewer state (F-16). */
export function targetEphemeral(p: WfPoll): EphemeralModel | null {
  if (p.status !== 'open' || !p.canVote) return null;
  const mine = p.slots.filter((s) => s.mine);
  const top = leader(p);
  const lines: EmbedLine[] = [
    mine.length === 0
      ? { id: 'mine', text: 'You have not voted yet.', tone: 'warn' }
      : { id: 'mine', text: `Your vote: ${mine.map((s) => `${s.day} ${s.time}`).join(', ')}`, tone: 'mine' },
  ];
  if (top) lines.push({ id: 'lead', text: `Leading: ${top.day} ${top.time} · ${top.votes} of ${p.members}`, tone: 'muted' });
  if (p.deadline) lines.push({ id: 'deadline', text: p.deadline, tone: 'muted' });
  return {
    headline: 'Your vote in this poll',
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
 * The select only earns its place past Discord's five-components-per-row
 * limit, so `targetActionRow` falls back to a single `Vote ▾` above five
 * slots. The operator has to rule on which shape ships, because it decides
 * whether a 6-slot poll degrades gracefully or gets a second row.
 */
export const TARGET_OPEN_QUESTION =
  'P4-1 open question: one button per slot (shown here, ≤5 slots) vs a single `Vote ▾` that opens a select. ' +
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
  'late-joiner': 'Catch-up line: where the group is at and how long is left (P-6, F-05).',
  'read-only-viewer': 'Buttons render disabled rather than failing server-side after an optimistic write (F-07).',
  expired: 'Expired is distinguishable from cancelled and from locked-in, and the deadline explains why (F-02, F-04).',
  'no-availability': 'Availability never reached the embed anyway — the ranked list is unaffected (F-14).',
};
