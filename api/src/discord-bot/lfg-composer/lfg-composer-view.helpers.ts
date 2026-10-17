/**
 * ROK-1685 AC3/AC4 — the pinned card's `View games ↗` answers privately.
 *
 * The card is public, so its `View games ↗` is a press (`lfgc:view`), not a
 * link: one token on it would sign in everyone who opened it. This handler
 * acknowledges ephemerally first (minting reads the database), then edits in
 * a single Link button carrying a magic link minted for the Discord user who
 * pressed and nobody else. A clicker with no Raid Ledger account gets the
 * plain /games link and nothing is minted. Every press mints anew; the link is
 * never cached and never logged.
 *
 * The reply is components-only on purpose — the button's label says what it
 * does, and the operator has approved no copy for this reply.
 */
import { ActionRowBuilder, MessageFlags } from 'discord.js';
import type { ButtonBuilder, ButtonInteraction } from 'discord.js';
import { LFG_COMPOSER_COPY } from './lfg-composer.constants';
import { buildViewGamesLinkButton } from './lfg-composer-card.helpers';
import {
  resolveComposerGamesUrl,
  type ComposerLinkDeps,
} from './lfg-composer-link.helpers';

/**
 * Answer one press of the pinned card's `View games ↗`, privately.
 *
 * @param deps - Database, settings and the magic-link minter.
 * @param interaction - The `lfgc:view` press.
 */
export async function viewComposerGames(
  deps: ComposerLinkDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const url = await resolveComposerGamesUrl(deps, interaction.user.id, '');
  const button = buildViewGamesLinkButton(url);
  if (!button) {
    // The web URL was removed after the card was posted; the next reconcile
    // drops the button from the card, so there is nothing to link to.
    await interaction.editReply({
      content: LFG_COMPOSER_COPY.FAILED_REPLY,
      components: [],
    });
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
  await interaction.editReply({ components: [row] });
}
