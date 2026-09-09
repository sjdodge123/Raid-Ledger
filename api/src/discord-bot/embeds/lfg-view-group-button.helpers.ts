/**
 * The `View the group` link button — ROK-1455 walk feedback 4.
 *
 * TWO surfaces render it and the operator asked for them to look like one
 * product: the invite DM card (`notification-embed.lfg-player-invite`) and the
 * ephemeral reply a Join press gets back (`LfgJoinListener`). The label and the
 * builder therefore live HERE rather than in either owner.
 *
 * Placement is load-bearing. `api/src/notifications/**` already imports from
 * `api/src/discord-bot/embeds/**` (chrome + personalized fields), so this
 * module keeps the existing one-way edge notifications -> discord-bot. Putting
 * the label in the notifications module and importing it from a discord-bot
 * listener would have closed that edge into a cycle.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** The link-style button's label. One string, both surfaces. */
export const LFG_INVITE_VIEW_LABEL = 'View the group';

/**
 * The link button itself.
 *
 * @param url - Absolute group-page URL. A Link button without one is a Discord
 *   API error, so callers must not invent a placeholder — omit the button.
 */
export function lfgViewGroupButton(url: string): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel(LFG_INVITE_VIEW_LABEL)
    .setStyle(ButtonStyle.Link)
    .setURL(url);
}

/**
 * The button wrapped in its own row, ready for a `components` array.
 *
 * @param url - Absolute group-page URL, or null when the client URL is
 *   unconfigured.
 * @returns A single row, or an empty array so the caller can spread it blindly.
 */
export function lfgViewGroupComponents(
  url: string | null | undefined,
): ActionRowBuilder<ButtonBuilder>[] {
  if (!url) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(lfgViewGroupButton(url)),
  ];
}
