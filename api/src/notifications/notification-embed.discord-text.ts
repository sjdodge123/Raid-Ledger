/**
 * The Discord rendering of notification text: user-typed masked links are
 * neutralised at the Discord boundary (the ROK-1896 `escapeHubName` rule,
 * extended to every notification type). Stored in-app text stays verbatim.
 *
 * Applied to the DM title/description, to every payload-driven field value
 * (`addFieldIf`) and to the structured bodies' user-text slots. A producer
 * that ever needs a DELIBERATE `[label](url)` in a notification message must
 * render it outside these paths (as `lfg_invite`'s Join line does), or it will
 * be defanged to plain text on Discord.
 */
import type { NotificationType } from '../drizzle/schema/notification-preferences';
import {
  hubProposalDiscordText,
  type NotificationDmText,
} from './notification-embed.hub-proposal';

/** An unescaped `[` — an even run of backslashes before it leaves it live. */
const LIVE_OPEN_BRACKET = /(?<!\\)((?:\\\\)*)\[/g;

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
  return text.replace(LIVE_OPEN_BRACKET, '$1\\[');
}

/**
 * The Discord rendering of ANY notification's title/message: the hub-proposal
 * name escaping, then masked links neutralised for every type.
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
    message: neutraliseMaskedLinks(text.message),
  };
}
