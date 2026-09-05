/**
 * DM body for the LFG "a group is forming" invite (ROK-1471 D11).
 *
 * This module owns the DESCRIPTION LINES only. `lfg_invite` is dispatched
 * through the ordinary notification pipeline, so the chrome (author, colour,
 * footer, buttons) comes from `DiscordNotificationEmbedService`, exactly like
 * every other notification type — `applyLfgInviteEmbed` is the single
 * production entry point. A parallel `createDmEmbed` builder used to live here
 * and had no caller; it was deleted rather than shipped as dead code (ROK-1471
 * review R3). Moving `lfg_invite` onto the DM chrome is a change to the shared
 * pipeline and belongs with the colour-axis cleanup, not here.
 */
import type { EmbedBuilder } from 'discord.js';
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
