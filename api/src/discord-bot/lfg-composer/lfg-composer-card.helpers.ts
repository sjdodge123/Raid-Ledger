/**
 * ROK-1612 — the pinned card and the search modal.
 *
 * PURE builders: no database, no settings, no client. `View games ↗` is a URL
 * button, which is the whole reason it is safe to leave on the card forever —
 * it raises no interaction, so it cannot fail, rate-limit or time out. Discord
 * rejects a Link button with an empty URL, so an unconfigured deployment loses
 * the link rather than the entire card (the rule `buildLfgPostComponents`
 * already follows).
 *
 * The modal carries exactly one text input. That asymmetry is forced, not
 * chosen: `LabelBuilder` appears 0 times in the installed discord.js typings,
 * so a select inside a modal is not buildable, and `ModalSubmitInteraction` has
 * no `showModal`, so a submit can never open another modal. Every reopen
 * therefore happens from a BUTTON — which is what makes `Back` possible at all.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  LFG_COMPOSER_COPY,
  LFG_COMPOSER_IDS,
  LFG_COMPOSER_TERM_MAX,
} from './lfg-composer.constants';
import { normalizeComposerTerm } from './lfg-composer-state.helpers';

/** The games page a `View games ↗` button opens, or null when unconfigured. */
export function gamesPageUrl(clientUrl?: string | null): string | null {
  const base = clientUrl?.trim();
  return base ? `${base.replace(/\/+$/, '')}/games` : null;
}

/**
 * The `View games ↗` link button, or null when the deployment has no web URL.
 *
 * @param clientUrl - Deployment client URL.
 * @returns The button, or null — callers spread the result so an unconfigured
 *   instance simply renders one fewer control.
 */
export function buildViewGamesButton(
  clientUrl?: string | null,
): ButtonBuilder | null {
  const url = gamesPageUrl(clientUrl);
  if (!url) return null;
  return new ButtonBuilder()
    .setStyle(ButtonStyle.Link)
    .setLabel(LFG_COMPOSER_COPY.VIEW_GAMES_BUTTON)
    .setURL(url);
}

/** What the composer card renders as. */
export interface LfgComposerCard {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

/**
 * The pinned composer card.
 *
 * Title only — the operator struck every line of subtitle and every mention of
 * not having to leave the channel.
 *
 * @param clientUrl - Deployment client URL; absent drops `View games ↗`.
 * @returns Content and one button row.
 */
export function buildComposerCard(clientUrl?: string | null): LfgComposerCard {
  const post = new ButtonBuilder()
    .setCustomId(LFG_COMPOSER_IDS.OPEN)
    .setStyle(ButtonStyle.Primary)
    .setLabel(LFG_COMPOSER_COPY.POST_BUTTON);
  const view = buildViewGamesButton(clientUrl);
  const buttons = view ? [post, view] : [post];
  return {
    content: LFG_COMPOSER_COPY.CARD_TITLE,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)],
  };
}

/**
 * The search modal, optionally prefilled.
 *
 * AC8/AC9 — `Back` and `Try again` both reopen it through here with the term
 * they carried, so a typo is EDITED rather than retyped. The input's max length
 * matches the custom-id term budget: anything typable can always be handed back.
 *
 * @param prefill - What to put in the box; empty opens it blank.
 * @returns A modal ready for `interaction.showModal`.
 */
export function buildComposerModal(prefill = ''): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId(LFG_COMPOSER_IDS.INPUT)
    .setLabel(LFG_COMPOSER_COPY.MODAL_INPUT_LABEL)
    .setPlaceholder(LFG_COMPOSER_COPY.MODAL_PLACEHOLDER)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(LFG_COMPOSER_TERM_MAX);
  const value = normalizeComposerTerm(prefill);
  if (value) input.setValue(value);
  return new ModalBuilder()
    .setCustomId(LFG_COMPOSER_IDS.MODAL)
    .setTitle(LFG_COMPOSER_COPY.MODAL_TITLE)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(input),
    );
}
