import { ButtonBuilder, ButtonStyle } from 'discord.js';

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
