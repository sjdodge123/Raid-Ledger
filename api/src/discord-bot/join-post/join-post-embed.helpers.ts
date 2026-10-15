/**
 * ROK-1740: the "Join Raid Ledger" embed and its link button (D7, D8).
 *
 * The button is a plain `ButtonStyle.Link` — no custom id, no interaction
 * handler. `/login` runs Discord OAuth, and a first-time member lands in
 * onboarding through the existing auth-success redirect (AC5).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  createChannelEmbed,
  type ChannelEmbed,
} from '../embeds/embed-chrome.helpers';
import {
  JOIN_POST_AUTHOR,
  JOIN_POST_BUTTON_LABEL,
  JOIN_POST_LOGIN_PATH,
} from './join-post.constants';

/** Discord OAuth asks for `identify` only — say exactly what that shares. */
export const JOIN_POST_PRIVACY_LINE =
  'Signing in with Discord shares only your Discord username and avatar.';

/** Who the post is for. */
export const JOIN_POST_MEMBERS_LINE = 'For members of this server.';

/**
 * Build the join embed.
 *
 * @param communityName - Resolved community name (branding).
 * @returns The channel embed, chrome applied.
 */
export function buildJoinPostEmbed(communityName: string): ChannelEmbed {
  const desc = [
    `Sign in to **${communityName}** to sign up for events, set your game time and get reminders.`,
    '',
    `**${JOIN_POST_MEMBERS_LINE}**`,
    JOIN_POST_PRIVACY_LINE,
  ];
  return createChannelEmbed({
    state: 'announcing',
    authorLine: JOIN_POST_AUTHOR,
    communityName,
  })
    .setTitle(`Join ${communityName}`)
    .setDescription(desc.join('\n'));
}

/**
 * The sign-in URL the button opens. Built by appending, like every other
 * bot embed link (`${clientUrl}/path`), so a client URL served under a
 * sub-path keeps it — `new URL('/login', base)` would drop it.
 *
 * @param clientUrl - The instance's configured client URL.
 */
export function joinPostLoginUrl(clientUrl: string): string {
  return `${clientUrl.replace(/\/+$/, '')}${JOIN_POST_LOGIN_PATH}`;
}

/**
 * One action row holding the "Join Raid Ledger" link button.
 *
 * @param clientUrl - The instance's configured client URL.
 */
export function buildJoinPostRow(
  clientUrl: string,
): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(JOIN_POST_BUTTON_LABEL)
    .setURL(joinPostLoginUrl(clientUrl));
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}
