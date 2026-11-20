/**
 * ROK-2272 S8 — the pure closing-line builder. Picks the copy constant for a
 * subject's end and fills its slots; user-supplied text (titles, reasons,
 * game names) is markdown-escaped, de-mentioned and capped, and the whole
 * line fits one Discord message.
 */
import { escapeMarkdown } from 'discord.js';
import { CLOSING_LINE_COPY as COPY } from './hub-forum-discord-closing-lines.copy';
import { DISCORD_MESSAGE_MAX } from './hub-forum-discord-content';

/** Longest slice of one user-supplied field, before escaping. */
export const CLOSING_FIELD_MAX = 300;

/** What ended, with the facts its line needs. */
export type ClosingLine =
  | { kind: 'poll-locked-in'; eventId: number; eventTitle: string }
  | { kind: 'poll-cancelled'; reason: string | null }
  | { kind: 'lineup-decided'; lineupId: number; games: readonly string[] }
  | { kind: 'lineup-aborted' };

/** Block-level markdown a user field must never start inside a bot line. */
const ESCAPE_ALL = {
  maskedLink: true,
  heading: true,
  bulletedList: true,
  numberedList: true,
} as const;

/**
 * Make user text inert inside a bot line: one line only (every whitespace
 * run, newlines included, becomes one space), markdown escaped including
 * masked links, headings, lists, a leading quote or `-#` sub-text, and `@everyone` /
 * `@here` / `<@id>` broken so nothing pings.
 */
export function neutralise(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = [...flat].slice(0, CLOSING_FIELD_MAX).join('');
  return escapeMarkdown(cut, ESCAPE_ALL)
    .replace(/^(>|-#)/, '\\$1')
    .replace(/@/g, '@\u200b');
}

function fill(template: string, slots: Record<string, string>): string {
  return template.replace(
    /\{(\w+)\}/g,
    (all, key: string) => slots[key] ?? all,
  );
}

function link(clientUrl: string, path: string): string {
  return `${clientUrl.replace(/\/+$/, '')}${path}`;
}

function decidedText(
  lineupId: number,
  games: readonly string[],
  clientUrl: string,
): string {
  const lineupLink = link(clientUrl, `/community-lineup/${lineupId}`);
  const names = games.map(neutralise).filter((g) => g !== '');
  if (names.length === 0) return fill(COPY.lineupDecidedNoGame, { lineupLink });
  const game = names.join(COPY.gameSeparator);
  return fill(COPY.lineupDecided, { game, lineupLink });
}

function rawText(line: ClosingLine, clientUrl: string): string {
  switch (line.kind) {
    case 'poll-locked-in':
      return fill(COPY.pollLockedIn, {
        eventTitle: neutralise(line.eventTitle),
        eventLink: link(clientUrl, `/events/${line.eventId}`),
      });
    case 'poll-cancelled': {
      const reason = neutralise(line.reason ?? '');
      return reason === ''
        ? COPY.pollCancelled
        : fill(COPY.pollCancelledReason, { reason });
    }
    case 'lineup-decided':
      return decidedText(line.lineupId, line.games, clientUrl);
    case 'lineup-aborted':
      return COPY.lineupAborted;
  }
}

/** The Discord text of one closing line, ≤ {@link DISCORD_MESSAGE_MAX}. */
export function closingLineText(line: ClosingLine, clientUrl: string): string {
  const text = rawText(line, clientUrl);
  if (text.length <= DISCORD_MESSAGE_MAX) return text;
  return `${text.slice(0, DISCORD_MESSAGE_MAX - 1)}…`;
}
