import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { escapeHubName } from '../discord-bot/services/discord-embed-event-body.helpers';
import type { NotificationType } from '../drizzle/schema/notification-preferences';

/** The title/message pair a notification DM embed renders. */
export interface NotificationDmText {
  title: string;
  message: string;
}

/** The user-supplied names a `hub_proposal_*` payload carries. */
const PROPOSAL_NAME_KEYS = ['hubName', 'proposerName'] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escape every occurrence of `names` in ONE pass (longest first), so an escaped name is never re-matched. */
function escapeNames(text: string, names: readonly string[]): string {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(sorted.map(escapeRegExp).join('|'), 'g');
  return text.replace(pattern, (match) => escapeHubName(match));
}

/**
 * The Discord rendering of a `hub_proposal_*` notice's title/message: the
 * user-supplied hub name (`payload.hubName`) and proposer display name
 * (`payload.proposerName`) are passed through {@link escapeHubName} so a name
 * like `[x](https://evil.example)` never renders as a masked link (or a
 * mention) in a staff DM. Escaping happens here, at the Discord boundary, so
 * the stored in-app text stays verbatim. Other types, or a payload without
 * either name, pass through unchanged.
 */
export function hubProposalDiscordText(input: {
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): NotificationDmText {
  const { title, message } = input;
  const isProposal =
    input.type === 'hub_proposal_submitted' ||
    input.type === 'hub_proposal_reviewed';
  const names = PROPOSAL_NAME_KEYS.map((k) => input.payload?.[k]).filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  if (!isProposal || names.length === 0) return { title, message };
  return {
    title: escapeNames(title, names),
    message: escapeNames(message, names),
  };
}

/** An unescaped `[` — an even run of backslashes before it leaves it live. */
const LIVE_OPEN_BRACKET = /(?<!\\)((?:\\\\)*)\[/g;

/**
 * Break every masked link in DM text: when the text holds a `](`, escape each
 * unescaped `[` (the same opener `escapeMarkdown`'s `maskedLink` escapes, but
 * for every link on the line and nested labels too). Notification text
 * interpolates user-controlled event titles, display names and game names, and
 * no notification message carries an intentional masked link, so
 * `[Free gold](https://evil.example)` must render as plain text plus a visible
 * URL rather than a disguised link from the trusted bot — the rule
 * {@link escapeHubName} already applies to hub names (ROK-1896). Idempotent:
 * an already-escaped `\[` is left alone, so a name escaped upstream is never
 * re-armed by a second backslash. Discord hides the backslash, so text
 * without a link renders exactly as before.
 */
export function neutraliseMaskedLinks(text: string): string {
  if (!text.includes('](')) return text;
  return text.replace(LIVE_OPEN_BRACKET, '$1\\[');
}

/**
 * The Discord rendering of ANY notification's title/message: the hub-proposal
 * name escaping above, then masked links neutralised for every type. Applied
 * at the Discord boundary only, so the stored in-app text stays verbatim.
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

/**
 * ROK-1870 — the Discord button of a hub proposal notice: submitted → the
 * admin queue, approved → the hub; a rejection carries no `url` ⇒ no button.
 */
export function buildHubProposalButton(
  payload: Record<string, unknown> | undefined,
  clientUrl: string,
): ButtonBuilder | null {
  const url = payload?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) return null;
  const label =
    payload?.outcome === 'approved' ? 'View hub' : 'Review proposals';
  return new ButtonBuilder()
    .setLabel(label)
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}${url}`);
}
