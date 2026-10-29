/**
 * ROK-1896 D6/D7 — a hub poll's DM names its hub and links to it.
 *
 * The producer (`poll-hub-payload.helpers.ts`) puts `hubId` + `hubName` on a
 * `community_lineup` payload only when the poll's hub is VISIBLE; both keys
 * are absent otherwise. These builders read the payload alone, like every
 * other DM button, so the in-app payload stays origin-free (id, not URL).
 */
import { ButtonBuilder, ButtonStyle, type EmbedBuilder } from 'discord.js';
import { HUB_LINK_LABEL } from '../discord-bot/embeds/hub-link-button.helpers';
import { escapeHubName } from '../discord-bot/services/discord-embed-event-body.helpers';

type Payload = Record<string, unknown> | undefined;

/** The payload's hub id, only when it is a positive safe integer. */
function pollHubId(payload: Payload): number | null {
  const hubId = payload?.hubId;
  if (typeof hubId !== 'number' || !Number.isSafeInteger(hubId)) return null;
  return hubId > 0 ? hubId : null;
}

/** One `Hub` Link button to `/hubs/<id>`, or null without a valid hub id. */
export function buildPollHubButton(
  payload: Payload,
  clientUrl: string,
): ButtonBuilder | null {
  const hubId = pollHubId(payload);
  if (hubId === null) return null;
  return new ButtonBuilder()
    .setLabel(HUB_LINK_LABEL)
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/hubs/${hubId}`);
}

/** Adds a `Hub` field carrying the escaped hub name, when the payload has one. */
export function addPollHubField(embed: EmbedBuilder, payload: Payload): void {
  const hubName = payload?.hubName;
  if (typeof hubName !== 'string' || !hubName) return;
  embed.addFields({ name: 'Hub', value: `**${escapeHubName(hubName)}**` });
}
