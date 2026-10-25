import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { escapeHubName } from '../discord-bot/services/discord-embed-event-body.helpers';
import type { NotificationType } from '../drizzle/schema/notification-preferences';

/** The title/message pair a notification DM embed renders. */
export interface NotificationDmText {
  title: string;
  message: string;
}

/**
 * The Discord rendering of a `hub_proposal_*` notice's title/message: the
 * proposer-supplied hub name (`payload.hubName`) is passed through
 * {@link escapeHubName} so a name like `[x](https://evil.example)` never
 * renders as a masked link (or a mention) in a staff DM. Escaping happens
 * here, at the Discord boundary, so the stored in-app text stays verbatim.
 * Other types, or a payload without a hub name, pass through unchanged.
 */
export function hubProposalDiscordText(input: {
  type: NotificationType;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}): NotificationDmText {
  const { title, message } = input;
  const hubName = input.payload?.hubName;
  const isProposal =
    input.type === 'hub_proposal_submitted' ||
    input.type === 'hub_proposal_reviewed';
  if (!isProposal || typeof hubName !== 'string' || hubName === '') {
    return { title, message };
  }
  const safe = escapeHubName(hubName);
  return {
    title: title.split(hubName).join(safe),
    message: message.split(hubName).join(safe),
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
