/**
 * Weekly Discord digest v2 — the `✨ Spotlight` field (ROK-1771 spec §4.1,
 * §4.3). One renderer per spotlight kind; every name goes through
 * `boldName`/`sanitizeName`, so a hostile name can never become a mention or
 * break the markdown. The spotlight is never trimmed by the §4.2 total pass.
 */
import type { APIEmbedField } from 'discord.js';
import {
  risingGameDeltaHours,
  type BossKillsCandidate,
  type CommonGroundCandidate,
  type DuoCandidate,
  type MarathonCandidate,
  type RisingGameCandidate,
  type SpotlightCandidate,
  type SpotlightKind,
} from './weekly-digest-spotlight.helpers';
import {
  DIGEST_FIELD_CAPS,
  boldName,
  eventLink,
  fitSectionLines,
  gameLink,
  sanitizeName,
  sliceCodePoints,
  type DigestLinks,
} from './weekly-digest-embed-text.helpers';

/** The label after `✨ Spotlight — ` for each kind. */
export const SPOTLIGHT_LABELS: Record<SpotlightKind, string> = {
  rising_game: 'Rising game',
  duo: 'Duo of the week',
  boss_kills: 'Boss kills',
  common_ground: 'Common Ground',
  marathon: 'Marathon',
};

/** Event titles listed under the duo line before "and N more". */
const DUO_TITLE_MAX = 3;

/** `✨ Spotlight — Duo of the week`. */
export function spotlightFieldName(kind: SpotlightKind): string {
  return `✨ Spotlight — ${SPOTLIGHT_LABELS[kind]}`;
}

/** `31 h`, `9.5 h` — one decimal, a trailing `.0` dropped. */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return `${String(rounded)} h`;
}

/** `4 h 40 m`, `3 h`, `45 m`. */
export function formatDuration(minutes: number): string {
  const total = Math.max(Math.round(minutes), 0);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${String(m)} m`;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} m`;
}

/** `**5** players` / `**1** player` (or an explicit plural form). */
export function boldCount(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `**${String(count)}** ${count === 1 ? singular : pluralForm}`;
}

function risingLines(
  c: RisingGameCandidate,
  links: DigestLinks | null,
): string[] {
  const name = boldName(c.game.name, gameLink(links, c.game.gameId));
  const delta = formatHours(risingGameDeltaHours(c));
  return [
    `${name} jumped to **${formatHours(c.hoursThisWeek)}** this week` +
      ` (▲ **${delta}**) across ${boldCount(c.playerCount, 'player')}.`,
  ];
}

function duoTitles(titles: readonly string[]): string | null {
  if (titles.length === 0) return null;
  const shown = titles.slice(0, DUO_TITLE_MAX).map(sanitizeName).join(', ');
  const hidden = titles.length - DUO_TITLE_MAX;
  return hidden > 0 ? `${shown} and ${String(hidden)} more` : shown;
}

function duoLines(c: DuoCandidate): string[] {
  const [a, b] = c.members;
  const head =
    `${boldName(a.name, null)} and ${boldName(b.name, null)} spent` +
    ` **${formatHours(c.minutesTogether / 60)}** together across` +
    ` ${boldCount(c.eventCount, 'event')}.`;
  const titles = duoTitles(c.eventTitles);
  return titles ? [head, titles] : [head];
}

function bossLines(c: BossKillsCandidate): string[] {
  const where = c.instanceName ? `${boldName(c.instanceName, null)} — ` : '';
  const kills = `${where}${boldCount(c.killCount, 'boss', 'bosses')} down.`;
  if (c.firstEverKills.length === 0) return [kills];
  const label = c.firstEverKills.length === 1 ? 'kill' : 'kills';
  const names = c.firstEverKills.map((n) => boldName(n, null)).join(', ');
  return [`${kills} First-ever ${label}: ${names} 🎉`];
}

function commonGroundLines(
  c: CommonGroundCandidate,
  links: DigestLinks | null,
): string[] {
  const winner = boldName(c.winner.name, gameLink(links, c.winner.gameId));
  const head =
    `The lineup picked ${winner} — **${String(c.winner.votes)}** of` +
    ` **${String(c.totalVotes)}** votes.`;
  if (!c.runnerUp) return [head];
  return [
    head,
    `Runner-up: ${boldName(c.runnerUp.name, null)} (${String(c.runnerUp.votes)}).`,
  ];
}

function marathonLines(
  c: MarathonCandidate,
  links: DigestLinks | null,
): string[] {
  const title = boldName(c.eventTitle, eventLink(links, c.eventId));
  return [
    `${title} ran **${formatDuration(c.durationMinutes)}** with` +
      ` ${boldCount(c.attendeeCount, 'player')}.`,
  ];
}

/** The 1–3 lines for one spotlight, by kind. */
export function spotlightLines(
  c: SpotlightCandidate,
  links: DigestLinks | null,
): string[] {
  switch (c.kind) {
    case 'rising_game':
      return risingLines(c, links);
    case 'duo':
      return duoLines(c);
    case 'boss_kills':
      return bossLines(c);
    case 'common_ground':
      return commonGroundLines(c, links);
    case 'marathon':
      return marathonLines(c, links);
  }
}

/** Markdown syntax characters; escaped (`\*`) occurrences are literal text. */
const MARKDOWN_SYNTAX = new Set(['*', '_', '`', '~', '|', '[']);

/**
 * Drop every unescaped markdown token (bold/italic/code/strike/spoiler
 * markers and masked-link syntax, keeping the link label) so a clipped line
 * can never leave an unbalanced `**`, `_` or `` ` ``. Escape pairs are kept
 * whole.
 */
export function plainMarkdown(line: string): string {
  let out = '';
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (ch === '\\') {
      out += line.slice(i, i + 2);
      i += 1;
    } else if (ch === ']' && line.charAt(i + 1) === '(') {
      const close = line.indexOf(')', i);
      i = close < 0 ? line.length : close;
    } else if (!MARKDOWN_SYNTAX.has(ch)) {
      out += ch;
    }
  }
  return out;
}

/**
 * Plain-text `line` cut to `cap` with `…`, never splitting an escape pair or
 * a surrogate pair.
 */
export function clipLine(line: string, cap: number): string {
  if (line.length <= cap) return line;
  const plain = plainMarkdown(line);
  if (plain.length <= cap) return plain;
  let cut = sliceCodePoints(plain, cap - 1);
  const trailing = /\\+$/.exec(cut)?.[0].length ?? 0;
  if (trailing % 2 === 1) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Fit lines under `cap` via `fitSectionLines`, which drops lines from the end
 * and, for a section with a tail ("+N more" / see-all link), ends with the
 * tail ALONE (`shown = 0`) before giving up. So the clip below runs only when
 * nothing fits — not even the tail by itself — or the section has no tail and
 * its first line is too long (only a pathological name or URL can do that).
 * Then the first line is returned alone, clipped as plain text, rather than
 * an empty value, which Discord rejects. Recap consequence: with its
 * `total = 1` tail, a recap URL of roughly 143–173 chars renders the tail
 * alone (`+1 more · [past events ↗](…)`, no counts); a longer one falls
 * through to the counts line alone.
 */
export function fitOrClip(
  lines: string[],
  total: number,
  seeAll: string | null,
  cap: number,
  label = 'see all',
  exact = true,
): string {
  const value = fitSectionLines(lines, total, seeAll, label, cap, exact);
  if (value !== '') return value;
  const first = lines[0];
  return first ? clipLine(first, cap) : '';
}

/** The spotlight field, or null when nothing was picked. */
export function spotlightField(
  pick: SpotlightCandidate | null,
  links: DigestLinks | null,
): APIEmbedField | null {
  if (!pick) return null;
  const lines = spotlightLines(pick, links);
  const value = fitOrClip(lines, 0, null, DIGEST_FIELD_CAPS.spotlight);
  if (value === '') return null;
  return { name: spotlightFieldName(pick.kind), value, inline: false };
}
