/**
 * ROK-1461 (slice C) — Community Lineup author-line grammar.
 *
 * The lineup family has NINE notification kinds; the shared chrome has FIVE
 * states. This module is the only place that collapses one onto the other,
 * writes the state-carrying author line, and builds the masked link that
 * replaced every call-to-action BUTTON. Mirrors
 * `discord-bot/services/discord-embed-event-chrome.helpers.ts` (ROK-1460).
 *
 * See `planning-artifacts/specs/ROK-1461.md` §Files (AC1, AC2, AC4).
 */
import type { EmbedState } from '../discord-bot/embeds/embed-chrome.helpers';
import { formatRelativeEpoch } from '../notifications/format-helpers';
import { maskedLink } from '../discord-bot/services/discord-embed-event-chrome.helpers';
import type { EmbedContext } from './lineup-notification-embed.helpers';

/** Author-line glyphs, spelled out so a mojibake diff stays readable. */
const DIE = '\u{1F3B2}'; // 🎲
const BALLOT = '\u{1F5F3}'; // 🗳 — deliberately no VS16
const TROPHY = '\u{1F3C6}'; // 🏆
const CALENDAR = '\u{1F4C5}'; // 📅
const SOLID = '●'; // ●
const SWORDS = '⚔\u{FE0F}'; // ⚔️
const DOTTED = '◌'; // ◌
const STOP = '\u{1F6D1}'; // 🛑
const SEP = '·'; // ·

/** The nine channel embeds the lineup lifecycle emits. */
export type LineupEmbedKind =
  | 'created'
  | 'milestone'
  | 'voting'
  | 'decided'
  | 'scheduling'
  | 'event_created'
  | 'tiebreaker_started'
  | 'tiebreaker_reminder'
  | 'aborted';

/** Kind onto the chrome state that owns its colour. */
const CHROME_STATES: Record<LineupEmbedKind, EmbedState> = {
  created: 'announcing',
  milestone: 'announcing',
  voting: 'announcing',
  scheduling: 'announcing',
  tiebreaker_started: 'announcing',
  tiebreaker_reminder: 'needs_you',
  decided: 'live',
  event_created: 'live',
  aborted: 'cancelled',
};

/**
 * Map a lineup embed kind onto the chrome state that owns its colour.
 *
 * @param kind - The notification being rendered.
 * @returns The chrome state understood by `colorForState`.
 */
export function lineupChromeState(kind: LineupEmbedKind): EmbedState {
  return CHROME_STATES[kind] ?? 'announcing';
}

/**
 * ` · closes in 2 days`, or nothing when the phase has no deadline.
 *
 * Operator walk 2026-09-02: Discord renders `<t:…>` markup in an embed's
 * DESCRIPTION and fields but NOT in the author line or footer — the card
 * showed the literal token. The delta is therefore rendered server-side with
 * the same helper the DM/push surfaces use.
 */
function closesSuffix(ctx: EmbedContext): string {
  if (!ctx.phaseDeadline) return '';
  const unix = Math.floor(ctx.phaseDeadline.getTime() / 1000);
  return ` ${SEP} closes ${formatRelativeEpoch(unix)}`;
}

/** ` · closes in 24h` — whole hours from now, floored at one. */
function closesInSuffix(ctx: EmbedContext): string {
  if (!ctx.phaseDeadline) return '';
  const hours = Math.round(
    (ctx.phaseDeadline.getTime() - Date.now()) / 3_600_000,
  );
  return ` ${SEP} closes in ${Math.max(1, hours)}h`;
}

/**
 * The state-carrying author line for a lineup notification (spec §Files).
 *
 * @param kind - The notification being rendered.
 * @param ctx - Lineup context supplying the deadline and tiebreaker round.
 * @returns e.g. `🎲 NOMINATIONS OPEN · closes in 2 days`. Never the bare
 *   community name — that is what this line replaced.
 */
export function lineupAuthorLineFor(
  kind: LineupEmbedKind,
  ctx: EmbedContext,
): string {
  switch (kind) {
    case 'voting':
      return `${BALLOT} VOTING OPEN${closesSuffix(ctx)}`;
    case 'decided':
      return `${TROPHY} MATCHES DECIDED`;
    case 'scheduling':
      return `${CALENDAR} SCHEDULING ${SEP} pick a time`;
    case 'event_created':
      return `${SOLID} EVENT CREATED`;
    case 'tiebreaker_started':
      return `${SWORDS} TIEBREAKER ${SEP} round ${ctx.tiebreakerRound ?? 1}`;
    case 'tiebreaker_reminder':
      return `${DOTTED} TIEBREAKER${closesInSuffix(ctx)}`;
    case 'aborted':
      return `${STOP} ABORTED`;
    default:
      return `${DIE} NOMINATIONS OPEN${closesSuffix(ctx)}`;
  }
}

/**
 * The masked link that replaced the call-to-action button (AC2).
 *
 * @param ctx - Lineup context supplying the web origin and lineup id.
 * @param label - Link text; `]` is escaped so it cannot break out of the mask.
 * @param matchId - When supplied, deep-links the match's scheduling poll.
 * @returns `[label](https://…/community-lineup/42)`.
 */
export function lineupLink(
  ctx: EmbedContext,
  label: string,
  matchId?: number,
): string {
  const base = `${ctx.baseUrl}/community-lineup/${ctx.lineupId}`;
  return maskedLink(label, matchId ? `${base}/schedule/${matchId}` : base);
}
