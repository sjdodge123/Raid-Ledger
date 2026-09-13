/**
 * TODAY's scheduling-poll embed grammar, reproduced for the ROK-1553
 * wireframe — DEV-ONLY, pure.
 *
 * Faithful copy of `api/src/discord-bot/services/discord-embed-scheduling.helpers.ts`
 * as it stands on `main`:
 *
 * - `schedulingPollAuthorLine` — `▸ POLL OPEN · N voters` /
 *   `● LOCKED IN · <time>` / `■ POLL CLOSED`. Three states only: the
 *   `SchedulingPollStatus` union has no `cancelled`, so a cancelled poll is
 *   `archived` → `closed` and reads identically to an expired one (F-02).
 * - `buildDescription` — intro line, blank, the TOP 3 slots as
 *   `<t:…:f> — **N** votes` (or `*No times suggested yet.*`), blank, the
 *   masked `Vote now ↗` link.
 * - No action row (ROK-1461 removed it), no deadline (F-04), no viewer state
 *   (F-16), no voter names (`buildEmbedSlots` computes them, nothing renders
 *   them — F-15).
 *
 * Do NOT "improve" anything here: the value of this column is that it is
 * wrong in exactly the ways the audit says production is wrong.
 */
import { EMBED_COLOR, type EmbedLine, type WfEmbedModel } from './embed-model';
import type { WfPoll, WfSlot } from './wireframe-states';

/** Top-3 cap in `discord-embed-scheduling.helpers.ts::MAX_DISPLAY_SLOTS`. */
const MAX_DISPLAY_SLOTS = 3;

/**
 * Collapse the wireframe's four states onto today's three-state embed union,
 * exactly as `pollStatusFromMatch` does: `cancelled` has nowhere to go.
 */
export function todayStatus(p: WfPoll): 'open' | 'locked_in' | 'closed' {
  if (p.status === 'locked') return 'locked_in';
  if (p.status === 'open') return 'open';
  return 'closed';
}

/** Author line — `schedulingPollAuthorLine`, glyph for glyph. */
export function todayAuthorLine(p: WfPoll): string {
  const status = todayStatus(p);
  if (status === 'closed') return '■ POLL CLOSED';
  if (status === 'locked_in') {
    return p.lockedTime ? `● LOCKED IN · ${p.lockedTime}` : '● LOCKED IN';
  }
  return `▸ POLL OPEN · ${p.voters} voter${p.voters === 1 ? '' : 's'}`;
}

/**
 * `sortedSlots` — votes descending and NOTHING else. No `proposedTime`
 * secondary key, which is the whole of F-03: `Array.prototype.sort` is
 * stable, so a tie falls back to whatever order the DB returned.
 */
export function todaySortedSlots(p: WfPoll): WfSlot[] {
  return [...p.slots].sort((a, b) => b.votes - a.votes);
}

/**
 * Slot lines. Discord renders `<t:…:f>` in each viewer's own zone; the mock
 * shows the rendered form because that is what a reader of the message sees.
 */
export function todaySlotLines(p: WfPoll): EmbedLine[] {
  if (p.slots.length === 0) {
    return [{ id: 'empty', text: 'No times suggested yet.', tone: 'muted' }];
  }
  return todaySortedSlots(p)
    .slice(0, MAX_DISPLAY_SLOTS)
    .map((s) => ({
      id: `slot-${s.id}`,
      text: `${s.day} ${s.time} — ${s.votes} vote${s.votes === 1 ? '' : 's'}`,
    }));
}

/** The whole of today's embed for one mocked state. */
export function todayEmbed(p: WfPoll): WfEmbedModel {
  const status = todayStatus(p);
  const color = status === 'open' ? EMBED_COLOR.open : status === 'locked_in' ? EMBED_COLOR.locked : EMBED_COLOR.closed;
  return {
    color,
    authorLine: todayAuthorLine(p),
    title: `When should we play ${p.game}?`,
    lines: [
      { id: 'intro', text: 'Vote for the best time to play!' },
      ...todaySlotLines(p),
    ],
    link: { label: 'Vote now ↗', href: '/community-lineup/1/schedule/1' },
    footer: 'Raid Ledger · Scheduling Poll',
    // ROK-1461 removed the button row, and one shared message carries no
    // per-viewer state. Both are `null` in EVERY state — that is the point.
    actionRow: null,
    ephemeral: null,
  };
}

/** One-line caption naming what this column is failing to say. */
export function todayCaption(p: WfPoll): string {
  if (p.status === 'cancelled') {
    return 'Cancelled renders as `■ POLL CLOSED` — the operator\'s reason never reaches Discord (F-02).';
  }
  if (p.status === 'closed') return 'Expired reads identically to cancelled; no deadline was ever shown (F-04).';
  if (p.status === 'locked') return 'The one thing today does better than the web page: it names the winning time (F-01).';
  if (p.slots.length > MAX_DISPLAY_SLOTS) return 'Top 3 slots only; ties fall back to DB order (F-03).';
  return 'Read-only: a masked link is the only affordance (F-17), no deadline (F-04), no "did I vote?" (F-16).';
}
