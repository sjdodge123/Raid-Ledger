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
