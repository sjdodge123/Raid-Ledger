/**
 * ROK-1471 D7 — the component row on an LFG board post.
 *
 * A PURE builder: no database, no settings, no Discord client. It exists as its
 * own module because the row is the reason `buildLfmEmbed` gained `linkStyle`
 * at all — the embed-design rule is "the masked link only where there is no
 * button row", so whoever attaches this row must pass `linkStyle: 'button'`,
 * and whoever gets `[]` back must not.
 *
 * The custom id is assembled from `LFG_BUTTON_IDS.JOIN`, the same constant
 * `parseJoinCustomId` (`listeners/lfg-join.listener.ts`) slices it apart with.
 * Nothing here calls `.setColor` — the chrome owns colour (D14b).
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import {
  LFG_NOW_SPAWN_BUTTON_LABEL,
  type LfgNowIndicatorEmoji,
} from '../lfg-now/lfg-now-indicator.helpers';
import type { LfmRenderState } from '../lfm/lfm-embed.helpers';
import {
  LFG_JOIN_BUTTON_LABEL,
  LFG_OPEN_GROUP_LABEL,
} from './lfg-board.constants';

/** Everything the row needs, already resolved by the caller. */
export interface LfgPostComponentInputs {
  /** Game the group is for — the only thing the button carries. */
  gameId: number;
  /** `games.slug`, for the web group page the Link button opens. */
  gameSlug: string;
  /** Deployment client URL. Empty or undefined drops the Link button. */
  clientUrl?: string;
  /** Where the group's message sits in the lifecycle. */
  state: LfmRenderState;
  /**
   * ROK-1619 — does the next `+1` cross `LFG_NOW_SPAWN_THRESHOLD`?
   *
   * Decided by `pressWouldSpawnNow` and passed IN, because this module is a
   * pure builder with no database: the count it would need lives on the view
   * the caller already read. Absent is the ROK-1471 button, byte for byte.
   */
  spawnsNow?: boolean;
  /**
   * The emoji to mark that press with, already resolved to component data by
   * `resolveNowIndicatorEmoji`. A `{ id, name }` custom emoji or a `{ name }`
   * Unicode one — never a `<:name:id>` string, which Discord would render as
   * literal text on the button (AC5).
   */
  spawnEmoji?: LfgNowIndicatorEmoji;
}

/**
 * Build the button row for a board post.
 *
 * The row carries a game id and NOTHING about who may press it: identity comes
 * from the interaction, so a replayed or hand-crafted id raises the clicker's
 * hand or nobody's (the rule `LfgJoinListener` is built on).
 *
 * @param inputs - Game, slug, client URL and the group's render state.
 * @returns One action row while the group is open; an EMPTY list at every
 *   terminal state, because a pressable `+1` on a converted group is a trap.
 */
export function buildLfgPostComponents(
  inputs: LfgPostComponentInputs,
): ActionRowBuilder<ButtonBuilder>[] {
  if (inputs.state !== 'open') return [];
  const join = new ButtonBuilder()
    .setCustomId(`${LFG_BUTTON_IDS.JOIN}:${String(inputs.gameId)}`)
    .setStyle(ButtonStyle.Primary)
    .setLabel(
      inputs.spawnsNow ? LFG_NOW_SPAWN_BUTTON_LABEL : LFG_JOIN_BUTTON_LABEL,
    );
  // AC6: the LABEL above already carries the meaning; the emoji is
  // reinforcement, so a viewer who does not recognise `:praise_sun:` still
  // knows what the press does. The custom id is untouched — the mark changes
  // how the press READS, never what it writes.
  if (inputs.spawnsNow && inputs.spawnEmoji) join.setEmoji(inputs.spawnEmoji);
  const buttons = [join];
  // Discord REJECTS a Link button with an empty URL, so an unconfigured
  // deployment loses the link rather than the whole post.
  if (inputs.clientUrl) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(LFG_OPEN_GROUP_LABEL)
        .setURL(`${inputs.clientUrl}/lfg/${inputs.gameSlug}`),
    );
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
}
