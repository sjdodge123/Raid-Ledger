/**
 * ROK-1612 step 4 — the urgency row, ordered by how soon it means.
 *
 * **The vocabulary belongs to ROK-1616, not to this story.** Nothing here
 * hardcodes a label or a value: the row is built from whatever
 * `LFG_URGENCY_CHOICES` currently holds, and the ordering is derived from each
 * value's HORIZON (`now:30` -> `now`), not from its label. So when 1616 re-cuts
 * the strings — `Right now · 30 min` became plain `Right now`, `Right now · 1
 * hour` retired, its slot became `Tonight` — this file keeps rendering soonest
 * first with no edit at all.
 *
 * An unranked horizon sorts last rather than throwing: a vocabulary this file
 * has never heard of must still render three pressable buttons.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  buildGoCustomId,
  type LfgComposerOrigin,
} from './lfg-composer-state.helpers';

/** Soonest first. The index is the rank; anything unlisted sorts after. */
const HORIZON_ORDER = ['now', 'tonight', 'week'] as const;

/** The emoji on the soonest button, and only on it. */
const SOONEST_EMOJI = '⚡';

/** A choice as `LFG_URGENCY_CHOICES` declares it. */
export interface UrgencyChoice {
  name: string;
  value: string;
}

/** The horizon half of a choice value — `now:30` -> `now`. */
export function horizonOf(value: string): string {
  return value.split(':')[0];
}

/** Rank by horizon; unknown horizons fall to the end in declaration order. */
function horizonRank(value: string): number {
  const idx = HORIZON_ORDER.indexOf(
    horizonOf(value) as (typeof HORIZON_ORDER)[number],
  );
  return idx === -1 ? HORIZON_ORDER.length : idx;
}

/**
 * The urgency choices, soonest first.
 *
 * @param choices - The live vocabulary.
 * @returns A new array; the input is never mutated (it is a module constant).
 */
export function orderUrgencyChoices(
  choices: ReadonlyArray<UrgencyChoice>,
): UrgencyChoice[] {
  return choices
    .map((choice, index) => ({ choice, index }))
    .sort(
      (a, b) =>
        horizonRank(a.choice.value) - horizonRank(b.choice.value) ||
        a.index - b.index,
    )
    .map((entry) => entry.choice);
}

/** Everything the urgency row needs, already resolved. */
export interface UrgencyRowInputs {
  gameId: number;
  term: string;
  origin: LfgComposerOrigin;
  choices: ReadonlyArray<UrgencyChoice>;
}

/**
 * The urgency button row — the only irreversible control in the whole flow.
 *
 * Nothing is written until one of these is pressed; abandoning the flow at any
 * earlier point creates no intent (AC3).
 *
 * @param inputs - Game, typed term, where Back goes, and the vocabulary.
 * @returns One action row, soonest first; every horizon is Primary, as the
 *   approved ROK-1658 prototype draws them, and only the soonest carries ⚡.
 */
export function buildUrgencyRow(
  inputs: UrgencyRowInputs,
): ActionRowBuilder<ButtonBuilder> {
  const ordered = orderUrgencyChoices(inputs.choices);
  const buttons = ordered.map((choice, index) => {
    const button = new ButtonBuilder()
      .setCustomId(
        buildGoCustomId({
          urgencyKey: choice.value,
          gameId: inputs.gameId,
          origin: inputs.origin,
          term: inputs.term,
        }),
      )
      .setStyle(ButtonStyle.Primary)
      .setLabel(choice.name);
    if (index === 0) button.setEmoji(SOONEST_EMOJI);
    return button;
  });
  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}
