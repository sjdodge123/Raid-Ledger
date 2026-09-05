/**
 * ROK-1471 D7 / AC5 — the component row under a forum post.
 *
 * The row is the reason `buildLfmEmbed` grew a `linkStyle` option at all: the
 * embed-design rule is *"the masked link only where there is no button row"*,
 * so a post that carries a Link button must not also carry the masked one.
 *
 * Two invariants live here rather than in the caller:
 *
 *  1. **Terminal states get NO row (AC5 iv).** A live `+1` on a group that
 *     already converted is not cosmetic — the press runs `createIntent` on a
 *     group that is over. Dropping the row is what makes the join listener's
 *     E11 refusal a backstop for stale clients rather than the only guard.
 *  2. **The `+1` never depends on the client URL.** A Link button without a
 *     URL is rejected at post time, which would cost the group its whole post;
 *     without a configured URL the row degrades to the `+1` alone.
 *
 * PURE: no database, no settings, no clock. Everything it renders is handed in.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { LFG_BUTTON_IDS } from '../discord-bot.constants';
import type { LfmRenderState } from '../lfm/lfm-embed.helpers';

/** Everything the row renders, already resolved by the caller. */
export interface LfgPostComponentInputs {
  /** `games.id` — the only thing the `+1` custom id carries (D6: never a user). */
  gameId: number;
  /** `games.slug`, for the Link button's `/lfg/<slug>` destination. */
  gameSlug: string;
  /** Deployment client URL, or null when none is configured. */
  clientUrl: string | null | undefined;
  /** Lifecycle position. Anything but `open` renders no row at all. */
  state: LfmRenderState;
}

/**
 * The `+1` button's custom id.
 *
 * Read back by `parseJoinCustomId` (`listeners/lfg-join.listener.ts`), which is
 * its only consumer — the two are asserted symmetric in the spec so a prefix
 * change cannot break the button while both sides stay individually green.
 *
 * @param gameId - The game whose group the press joins.
 * @returns `lfg:join:<gameId>`.
 */
export function joinCustomId(gameId: number): string {
  return `${LFG_BUTTON_IDS.JOIN}:${String(gameId)}`;
}

/**
 * Build the component row for a forum post.
 *
 * @param inputs - Game identity, client URL and the lifecycle state.
 * @returns One action row while the group is open; an empty array at every
 *   terminal state, which is what the caller passes to `components` to CLEAR
 *   the row on the final edit.
 */
export function buildLfgPostComponents(
  inputs: LfgPostComponentInputs,
): ActionRowBuilder<ButtonBuilder>[] {
  if (inputs.state !== 'open') return [];

  const join = new ButtonBuilder()
    .setCustomId(joinCustomId(inputs.gameId))
    .setStyle(ButtonStyle.Primary)
    .setLabel("+1 · I'm in");

  const buttons = [join];
  if (inputs.clientUrl) {
    buttons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Open group ↗')
        .setURL(`${inputs.clientUrl}/lfg/${inputs.gameSlug}`),
    );
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)];
}
