/**
 * ROK-1612 AC2–AC5, AC8, AC9 — what each composer press does.
 *
 * One function per step, each taking its dependencies explicitly so every step
 * is unit-testable with a fake interaction (a bot cannot click another bot's
 * button, so the companion smoke suite cannot drive these). Three rules:
 *
 *  1. **AC5 runs BEFORE the modal opens.** Nobody types a game name only to be
 *     refused. `showModal` must be the interaction's FIRST response, so the
 *     check is one indexed read and the modal cannot be deferred.
 *  2. **Every slow step acknowledges first** (`deferUpdate` / `deferReply`)
 *     and then edits, so a cold search never trips Discord's 3-second window.
 *  3. **AC4 — one write path.** The urgency press calls `LfgService.createIntent`,
 *     the method `/lfg` and the board's `+1` call; the public card repaints via
 *     the existing `GROUP_CHANGED` consumer. This file posts nothing itself.
 */
import { MessageFlags } from 'discord.js';
import type {
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
} from 'discord.js';
import type { LfgService } from '../../lfg/lfg.service';
import type { SettingsService } from '../../settings/settings.service';
import {
  LFG_BLOCKED_REPLY,
  LFG_UNLINKED_REPLY,
  LFG_URGENCY_CHOICES,
  parseUrgencyChoice,
} from '../commands/lfg.command.helpers';
import { resolveLfgCaller, type LfgCaller } from '../commands/lfg.command';
import { buildLfgJoinConfirmation } from '../listeners/lfg-join-confirmation.helpers';
import { LFG_COMPOSER_COPY, LFG_COMPOSER_IDS } from './lfg-composer.constants';
import { buildComposerModal } from './lfg-composer-card.helpers';
import {
  buildCandidatesReply,
  buildNoMatchReply,
  buildUrgencyReply,
  type LfgComposerReply,
} from './lfg-composer-reply.helpers';
import { classifyComposerMatch } from './lfg-composer-search.helpers';
import {
  findComposerGame,
  searchComposerGames,
  searchComposerGamesFuzzy,
  type Db,
} from './lfg-composer-search.db-helpers';
import {
  normalizeComposerTerm,
  parseGoCustomId,
  parseTermCustomId,
  urgencyValueFor,
} from './lfg-composer-state.helpers';

/** What every step needs. Narrowed so a spec fakes only what is used. */
export interface ComposerFlowDeps {
  db: Db;
  lfgService: Pick<LfgService, 'createIntent'>;
  settingsService: Pick<
    SettingsService,
    'getClientUrl' | 'getDiscordBotTimezone'
  >;
}

/** AC5 — the `/lfg` refusal for this caller, or null when they may post. */
function refusalFor(caller: LfgCaller | null): string | null {
  if (!caller) return LFG_UNLINKED_REPLY;
  if (caller.deactivatedAt || caller.bannedAt) return LFG_BLOCKED_REPLY;
  return null;
}

/**
 * `Post an LFG`, `Back` to search and `Try again` — open the (prefilled) modal.
 *
 * @param deps - Flow dependencies.
 * @param interaction - The pressed button.
 * @param prefill - What was typed last time; empty for the card's own button.
 */
export async function openComposerModal(
  deps: ComposerFlowDeps,
  interaction: ButtonInteraction,
  prefill: string,
): Promise<void> {
  const caller = await resolveLfgCaller(deps.db, interaction.user.id);
  const refusal = refusalFor(caller);
  if (refusal) {
    await interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.showModal(buildComposerModal(prefill));
}

/**
 * Run the search and render whichever of the four AC2 outcomes it lands on.
 *
 * @param deps - Flow dependencies.
 * @param rawTerm - What was typed.
 * @returns The ephemeral reply for that outcome.
 */
export async function renderComposerSearch(
  deps: ComposerFlowDeps,
  rawTerm: string,
): Promise<LfgComposerReply> {
  const term = normalizeComposerTerm(rawTerm);
  const clientUrl = await deps.settingsService.getClientUrl();
  if (!term) return buildNoMatchReply(term, clientUrl);
  const matches = await searchComposerGames(deps.db, term);
  const fuzzy = matches.length
    ? []
    : await searchComposerGamesFuzzy(deps.db, term);
  const match = classifyComposerMatch(term, matches, fuzzy);
  if (match.kind === 'none') return buildNoMatchReply(term, clientUrl);
  if (match.kind === 'exact') {
    const choices = LFG_URGENCY_CHOICES;
    return buildUrgencyReply({
      game: match.game,
      term,
      origin: 'search',
      choices,
      clientUrl,
    });
  }
  return buildCandidatesReply(
    term,
    match.games,
    match.kind === 'fuzzy',
    clientUrl,
  );
}

/**
 * The modal's submit. Opened from the pinned card it answers with a NEW
 * ephemeral; opened from an ephemeral step's button it replaces that step in
 * place, so Back/Try again never stack a trail of stale replies.
 */
export async function submitComposerSearch(
  deps: ComposerFlowDeps,
  interaction: ModalSubmitInteraction,
): Promise<void> {
  const term = interaction.fields.getTextInputValue(LFG_COMPOSER_IDS.INPUT);
  const inPlace =
    interaction.isFromMessage() &&
    interaction.message.flags.has(MessageFlags.Ephemeral);
  if (inPlace) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await renderComposerSearch(deps, term));
}

/** AC9 — `Back` from the urgency step re-renders the candidate select. */
export async function backToComposerCandidates(
  deps: ComposerFlowDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  const term =
    parseTermCustomId(
      interaction.customId,
      LFG_COMPOSER_IDS.BACK_TO_CANDIDATES,
    ) ?? '';
  await interaction.deferUpdate();
  await interaction.editReply(await renderComposerSearch(deps, term));
}

/** A candidate picked — step 4 for that game, with Back to the select. */
export async function pickComposerGame(
  deps: ComposerFlowDeps,
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  const term =
    parseTermCustomId(interaction.customId, LFG_COMPOSER_IDS.PICK) ?? '';
  await interaction.deferUpdate();
  const raw = interaction.values[0] ?? '';
  const game = /^\d+$/.test(raw)
    ? await findComposerGame(deps.db, Number(raw))
    : null;
  const clientUrl = await deps.settingsService.getClientUrl();
  if (!game) {
    await interaction.editReply(buildNoMatchReply(term, clientUrl));
    return;
  }
  await interaction.editReply(
    buildUrgencyReply({
      game,
      term,
      origin: 'candidates',
      choices: LFG_URGENCY_CHOICES,
      clientUrl,
    }),
  );
}

/**
 * The one irreversible press. Re-checks AC5 (a card can outlive a ban), then
 * writes through `createIntent` and replaces the step with the `+1` button's
 * own confirmation — no Back, because there is nothing left to go back to.
 */
export async function goComposer(
  deps: ComposerFlowDeps,
  interaction: ButtonInteraction,
): Promise<void> {
  const state = parseGoCustomId(interaction.customId);
  if (!state) return;
  await interaction.deferUpdate();
  const caller = await resolveLfgCaller(deps.db, interaction.user.id);
  const refusal = refusalFor(caller);
  const value = urgencyValueFor(state.urgencyKey, LFG_URGENCY_CHOICES);
  if (refusal || !caller || !value) {
    const content = refusal ?? LFG_COMPOSER_COPY.STALE_REPLY;
    await interaction.editReply({ content, components: [] });
    return;
  }
  const timezone = await deps.settingsService.getDiscordBotTimezone();
  const result = await deps.lfgService.createIntent(caller.id, state.gameId, {
    ...parseUrgencyChoice(value),
    timezone,
  });
  const clientUrl = await deps.settingsService.getClientUrl();
  await interaction.editReply(buildLfgJoinConfirmation(result, clientUrl));
}
