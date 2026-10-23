/**
 * ROK-1933 Part 4 — the hub welcome embed and its link buttons. Kind-agnostic:
 * a hub kind (plugin) supplies the claim hint / description; without a hint
 * the claim field and button are left out. Buttons are plain
 * `ButtonStyle.Link` — no custom id, no interaction handler.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import { HUB_WELCOME_COPY, HUB_WELCOME_PATHS } from './hub-welcome.constants';

/** Input for {@link buildHubWelcomeEmbed}. */
export interface HubWelcomeEmbedInput {
  hubId: number;
  hubName: string;
  /** Plugin copy for "Claim your character"; omitted → no claim field. */
  claimHint?: string | null;
  /** Plugin description; omitted → the generic one. */
  description?: string | null;
  /** Resolved community name (branding) for the embed chrome. */
  communityName?: string | null;
}

/** Input for {@link buildHubWelcomeRow}. */
export interface HubWelcomeRowInput {
  hubId: number;
  /** The instance's configured client URL (`SettingsService.getClientUrl`). */
  clientUrl: string;
  /** Show [Claim your character] — true when the kind supplied a claim hint. */
  withClaim: boolean;
}

/**
 * Absolute hub + Characters URLs. Appended like every bot embed link
 * (`${clientUrl}/path`) so a client URL under a sub-path keeps it.
 *
 * @param clientUrl - The instance's configured client URL.
 * @param hubId - The hub (guild) id.
 */
export function hubWelcomeUrls(
  clientUrl: string,
  hubId: number,
): { hub: string; characters: string } {
  const hub = `${clientUrl.replace(/\/+$/, '')}${HUB_WELCOME_PATHS.hub(hubId)}`;
  return { hub, characters: `${hub}${HUB_WELCOME_PATHS.charactersHash}` };
}

/**
 * Build the welcome embed: author marker, "<hub> on Raid Ledger", the
 * description, then "Claim your character" (when hinted) and "New here?".
 *
 * @param input - Hub identity plus optional plugin copy.
 * @returns The channel embed, chrome applied.
 */
export function buildHubWelcomeEmbed(
  input: HubWelcomeEmbedInput,
): ChannelEmbed {
  const embed = createChannelEmbed({
    state: 'announcing',
    authorLine: HUB_WELCOME_COPY.author,
    communityName: input.communityName ?? null,
  })
    .setTitle(HUB_WELCOME_COPY.title(input.hubName))
    .setDescription(
      input.description ?? HUB_WELCOME_COPY.description(input.hubName),
    );
  if (input.claimHint) {
    embed.addFields({
      name: HUB_WELCOME_COPY.claimFieldName,
      value: input.claimHint,
    });
  }
  return embed.addFields({
    name: HUB_WELCOME_COPY.newHereName,
    value: HUB_WELCOME_COPY.newHereValue,
  });
}

/**
 * One action row: [Open the hub] and, when `withClaim`, [Claim your character].
 *
 * @param input - Hub id, client URL and whether the claim button shows.
 */
export function buildHubWelcomeRow(
  input: HubWelcomeRowInput,
): ActionRowBuilder<ButtonBuilder> {
  const urls = hubWelcomeUrls(input.clientUrl, input.hubId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    linkButton(HUB_WELCOME_COPY.openHubLabel, urls.hub),
  );
  if (input.withClaim) {
    row.addComponents(linkButton(HUB_WELCOME_COPY.claimLabel, urls.characters));
  }
  return row;
}

function linkButton(label: string, url: string): ButtonBuilder {
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(label)
    .setURL(url);
}
