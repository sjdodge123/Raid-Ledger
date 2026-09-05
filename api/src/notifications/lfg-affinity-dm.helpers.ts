/**
 * DM body for the LFG "a group is forming" invite (ROK-1471 D11).
 *
 * Always a DM surface: built with `createDmEmbed`, never `createChannelEmbed`
 * — the copy is addressed to one subscriber and the board embed is a separate
 * artefact with channel grammar.
 */
import type { EmbedBuilder } from 'discord.js';
import {
  createDmEmbed,
  type DmEmbed,
} from '../discord-bot/embeds/embed-chrome.helpers';
import { toStr } from './notification-embed.helpers';

/** Everything the invite DM renders. */
export interface LfgInviteDmInput {
  gameName: string;
  gameSlug: string;
  /** Live intent holders on the group right now. */
  memberCount: number;
  /** Base URL of the web app; null renders the DM without a link. */
  clientUrl?: string | null;
  /** Pre-built group link, when the caller already resolved one. */
  url?: string | null;
  communityName?: string | null;
}

/**
 * Build the LFG group link for a game.
 *
 * @param clientUrl - Base URL of the web app, or null/empty for "no link".
 * @param gameSlug - Slug of the game the group formed around.
 * @returns The absolute group URL, or null when no client URL is configured.
 */
export function buildLfgInviteUrl(
  clientUrl: string | null | undefined,
  gameSlug: string,
): string | null {
  if (!clientUrl) return null;
  return `${clientUrl.replace(/\/+$/, '')}/lfg/${gameSlug}`;
}

/**
 * Build the description lines of the invite DM.
 *
 * @param input - Game, member count and link inputs.
 * @returns Ordered markdown lines; the link line is omitted when unavailable.
 */
export function buildLfgInviteLines(input: LfgInviteDmInput): string[] {
  const lines = [
    `🎮 **${input.gameName}**`,
    `👥 ${input.memberCount} looking to play`,
  ];
  const url = input.url ?? buildLfgInviteUrl(input.clientUrl, input.gameSlug);
  if (url) lines.push(`[Join the group](${url})`);
  return lines;
}

/**
 * Build the standalone invite DM embed with the shared DM chrome.
 *
 * @param input - Game, member count and link inputs.
 * @returns A `DmEmbed` — colour, author and footer come from the chrome.
 */
export function buildLfgInviteDmEmbed(input: LfgInviteDmInput): DmEmbed {
  const embed = createDmEmbed({
    state: 'announcing',
    communityName: input.communityName ?? null,
    footerLabel: 'Looking for group',
  });
  embed.setDescription(buildLfgInviteLines(input).join('\n'));
  return embed;
}

/**
 * Apply the invite description to an embed the notification pipeline built.
 *
 * Mirrors `applySubscribedGameEmbed`: the pipeline owns the chrome, this owns
 * the body.
 *
 * @param embed - Embed to mutate in place.
 * @param payload - Stored notification payload.
 */
export function applyLfgInviteEmbed(
  embed: EmbedBuilder,
  payload: Record<string, unknown>,
): void {
  const memberCount = Number(payload.memberCount);
  embed.setDescription(
    buildLfgInviteLines({
      gameName: toStr(payload.gameName),
      gameSlug: toStr(payload.gameSlug),
      memberCount: Number.isFinite(memberCount) ? memberCount : 0,
      url: typeof payload.url === 'string' ? payload.url : null,
    }).join('\n'),
  );
}
