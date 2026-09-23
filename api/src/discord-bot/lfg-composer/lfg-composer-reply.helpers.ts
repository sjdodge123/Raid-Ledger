/**
 * ROK-1612 AC8/AC9 — the three ephemeral replies, none of which is a dead end.
 *
 * Every reply built here carries `← Back`; every RESULTS message also carries
 * `View games ↗`, and the When step carries Back alone (the approved ROK-1658
 * prototype, steps 3a–3d and 4). No path may leave someone with a dismissed
 * modal and nothing to press. `Back` is a BUTTON, never a modal submit
 * response, because `ModalSubmitInteraction` has no `showModal` — the
 * constraint the whole flow is shaped around.
 *
 * Where Back goes (AC9, as amended by ROK-1658): from any results message —
 * nothing-found included — it reopens the modal prefilled; from the When step
 * it returns to the results list, because the select is the only way in.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import {
  LFG_COMPOSER_COPY,
  composerCandidatesHeading,
  composerDidYouMeanHeading,
  composerNoMatchHeading,
  composerUrgencyHeading,
} from './lfg-composer.constants';
import {
  buildBackCustomId,
  buildBackToCandidatesCustomId,
  buildPickCustomId,
  normalizeComposerTerm,
  type LfgComposerOrigin,
} from './lfg-composer-state.helpers';
import { buildViewGamesButton } from './lfg-composer-card.helpers';
import type { LfgComposerGame } from './lfg-composer-search.helpers';
import {
  buildUrgencyRow,
  type UrgencyChoice,
} from './lfg-composer-urgency.helpers';

/** An ephemeral composer reply: content plus its component rows. */
export interface LfgComposerReply {
  content: string;
  components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[];
}

/** Discord caps a select option label at 100 characters. */
const OPTION_LABEL_MAX = 100;

/** A `← Back` button with the given destination id. */
function buildBackButton(backId: string): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(backId)
    .setStyle(ButtonStyle.Secondary)
    .setLabel(LFG_COMPOSER_COPY.BACK_BUTTON);
}

/**
 * The `← Back` / `View games ↗` tail every results message ends with.
 *
 * @param term - Typed text, carried so Back can reopen the modal prefilled.
 * @param clientUrl - Deployment client URL; absent drops the link button.
 * @returns One action row of one or two buttons.
 */
export function buildComposerTailRow(
  term: string,
  clientUrl?: string | null,
): ActionRowBuilder<ButtonBuilder> {
  const back = buildBackButton(buildBackCustomId(term));
  const view = buildViewGamesButton(clientUrl);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    view ? [back, view] : [back],
  );
}

/**
 * The candidate select — for both the ambiguous and the "did you mean" cases.
 *
 * Kept as ONE builder with a heading argument rather than two: the two outcomes
 * must never diverge in whether they auto-select, and a single builder makes
 * that structural rather than remembered.
 *
 * @param term - What was typed.
 * @param games - Ranked candidates, already capped at 25 by the classifier.
 * @param fuzzy - True when these came from the trigram re-query.
 * @param clientUrl - Deployment client URL.
 * @returns The ephemeral reply.
 */
export function buildCandidatesReply(
  term: string,
  games: LfgComposerGame[],
  fuzzy: boolean,
  clientUrl?: string | null,
): LfgComposerReply {
  const shown = normalizeComposerTerm(term);
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildPickCustomId(term))
    .setPlaceholder(LFG_COMPOSER_COPY.SELECT_PLACEHOLDER)
    .addOptions(games.map(toSelectOption));
  return {
    content: fuzzy
      ? composerDidYouMeanHeading(shown)
      : composerCandidatesHeading(games.length, shown),
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      buildComposerTailRow(term, clientUrl),
    ],
  };
}

/** One game as a select option; the value is the id the urgency step needs. */
function toSelectOption(game: LfgComposerGame): StringSelectMenuOptionBuilder {
  return new StringSelectMenuOptionBuilder()
    .setLabel(game.name.slice(0, OPTION_LABEL_MAX))
    .setValue(String(game.id));
}

/**
 * Everything the urgency reply needs, already resolved by the caller. `origin`
 * is encoded into the go id only (see `LfgComposerOrigin`); it no longer picks
 * where Back goes.
 */
export interface UrgencyReplyInputs {
  game: LfgComposerGame;
  term: string;
  origin: LfgComposerOrigin;
  choices: ReadonlyArray<UrgencyChoice>;
  clientUrl?: string | null;
}

/**
 * Step 4 — names the game, offers the horizons, and goes back to the results.
 * Back is the only other control: the prototype's When step has no
 * `View games ↗` (`clientUrl` is accepted for call-site symmetry, unused).
 *
 * @param inputs - Game, term, origin, vocabulary and client URL.
 * @returns The ephemeral reply.
 */
export function buildUrgencyReply(
  inputs: UrgencyReplyInputs,
): LfgComposerReply {
  return {
    content: composerUrgencyHeading(inputs.game.name),
    components: [
      buildUrgencyRow({
        gameId: inputs.game.id,
        term: inputs.term,
        origin: inputs.origin,
        choices: inputs.choices,
      }),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildBackButton(buildBackToCandidatesCustomId(inputs.term)),
      ),
    ],
  };
}

/**
 * Nothing found — no select, only `← Back` (reopens the modal prefilled) and
 * `View games ↗`. The prototype has no separate `Try again` (ROK-1658).
 *
 * @param term - What was typed and found nothing.
 * @param clientUrl - Deployment client URL.
 * @returns The ephemeral reply.
 */
export function buildNoMatchReply(
  term: string,
  clientUrl?: string | null,
): LfgComposerReply {
  return {
    content: composerNoMatchHeading(normalizeComposerTerm(term)),
    components: [buildComposerTailRow(term, clientUrl)],
  };
}
