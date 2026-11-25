/**
 * The Discord rendering of notification text: user-typed masked links are
 * neutralised at the Discord boundary (the ROK-1896 `escapeHubName` rule,
 * extended to every notification type). Stored in-app text stays verbatim.
 *
 * Applied to the DM title/description, to every payload-driven field value
 * (`addFieldIf`) and to the structured bodies' user-text slots. A producer
 * whose message carries the bot's OWN `[label](url)` links (the lineup ballot
 * and tiebreaker CTAs) escapes each user value where it enters the text
 * ({@link escapeLinkLabel} / {@link escapeLinkOpeners}) and sets
 * {@link BOT_LINKS_KEY} in the payload, so the description is not blanket-
 * escaped and its links stay clickable.
 */
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import {
  hubProposalDiscordText,
  type NotificationDmText,
} from './notification-embed.hub-proposal';

/** An unescaped `[` — an even run of backslashes before it leaves it live. */
const LIVE_OPEN_BRACKET = /(?<!\\)((?:\\\\)*)\[/g;
/** An unescaped `]`, same backslash rule. */
const LIVE_CLOSE_BRACKET = /(?<!\\)((?:\\\\)*)\]/g;

/**
 * Payload flag: the message holds bot-authored masked links and every user
 * value in it was escaped at the source, so the Discord boundary must not
 * blanket-escape the description (the title and fields still are).
 */
export const BOT_LINKS_KEY = 'messageHasBotLinks';

/** Discord's embed text limits (a longer value makes `EmbedBuilder` throw). */
export const DISCORD_LIMITS = {
  title: 256,
  description: 4096,
  fieldValue: 1024,
} as const;

/** Escape every unescaped `[` in a user value, link or not (idempotent). */
export function escapeLinkOpeners(value: string): string {
  return value.replace(LIVE_OPEN_BRACKET, '$1\\[');
}

/**
 * A user value placed INSIDE a bot link's label: both brackets escaped, so it
 * can neither open a link of its own nor close the bot's label early.
 */
export function escapeLinkLabel(value: string): string {
  return escapeLinkOpeners(value).replace(LIVE_CLOSE_BRACKET, '$1\\]');
}

/**
 * Cut text to a Discord limit AFTER escaping, ending in `…`: never splits a
 * surrogate pair and never leaves a dangling half of a `\[` escape.
 */
export function fitDiscordText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const run = /\\+$/.exec(cut)?.[0].length ?? 0;
  if (run % 2 === 1) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Break every masked link in DM text: when the text holds a `](`, escape each
 * unescaped `[` (the same opener `escapeMarkdown`'s `maskedLink` escapes, but
 * for every link on the line and nested labels too). Notification text
 * interpolates user-controlled event titles, display names and game names, so
 * `[Free gold](https://evil.example)` must render as plain text plus a visible
 * URL rather than a disguised link from the trusted bot. Idempotent: an
 * already-escaped `\[` is left alone, so a name escaped upstream (e.g. by
 * `escapeHubName`) is never re-armed by a second backslash. Discord hides the
 * backslash, so text without a link renders exactly as before.
 */
export function neutraliseMaskedLinks(text: string): string {
  if (!text.includes('](')) return text;
  return escapeLinkOpeners(text);
}

/**
 * The Discord rendering of ANY notification's title/message: the hub-proposal
 * name escaping, then masked links neutralised for every type — except a
 * message flagged {@link BOT_LINKS_KEY}, already escaped at its source.
 */
export function notificationDiscordText(input: {
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): NotificationDmText {
  const text = hubProposalDiscordText(input);
  return {
    title: neutraliseMaskedLinks(text.title),
    message:
      input.payload?.[BOT_LINKS_KEY] === true
        ? text.message
        : neutraliseMaskedLinks(text.message),
  };
}
