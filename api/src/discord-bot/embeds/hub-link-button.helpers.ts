/**
 * The game-hub link on channel embeds — ROK-1872 (ROK-1428 §2.8, D16).
 *
 * Lives beside `lfg-view-group-button.helpers.ts` for the same one-way-edge
 * reason: event cards (discord-bot) and any future notifications surface can
 * both import it without closing an import cycle.
 */
import { ButtonBuilder, ButtonStyle } from 'discord.js';

/** Label when the link targets one hub page (`/guilds/<id>`). */
export const HUB_LINK_LABEL = 'Hub';
/** Label when the game has several hubs and the link targets `/hubs?game=<id>`. */
export const HUBS_LINK_LABEL = 'Hubs';

/** A resolved, absolute hub link. */
export interface HubLink {
  url: string;
  label: typeof HUB_LINK_LABEL | typeof HUBS_LINK_LABEL;
}

/**
 * The hub Link button, or null when there is no link. A Link button without
 * a URL is a Discord API error, so there is never a placeholder.
 *
 * @param link - Resolved hub link, if any.
 */
export function hubLinkButton(
  link: HubLink | null | undefined,
): ButtonBuilder | null {
  if (!link) return null;
  return new ButtonBuilder()
    .setLabel(link.label)
    .setStyle(ButtonStyle.Link)
    .setURL(link.url);
}
