import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import type { CharacterDto } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import { createDmEmbed, type DmEmbed } from '../embeds/embed-chrome.helpers';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';
import {
  showCharacterSelect,
  showRoleSelect,
} from '../utils/signup-dropdown-builders';
import {
  buildSeriesCustomId,
  formatJoinSummary,
  type SeriesRole,
} from './series-signup-interaction.helpers';
import type {
  SeriesInteraction,
  SeriesInteractionDeps,
} from './series-signup-interaction.handlers';

/** The character + roles carried from step to step in the customIds. */
export type Picks = { characterId: string | null; roles: SeriesRole[] | null };
type EventRow = typeof schema.events.$inferSelect;

/** No picks yet — the embed's Join Series button. */
export const NO_PICKS: Picks = { characterId: null, roles: null };

async function loadCharacters(
  event: EventRow,
  userId: number,
  deps: SeriesInteractionDeps,
): Promise<CharacterDto[]> {
  if (!event.gameId) return [];
  return (await deps.charactersService.findAllForUser(userId, event.gameId))
    .data;
}

function isMmo(event: EventRow): boolean {
  const slot = event.slotConfig as Record<string, unknown> | null;
  return slot?.type === 'mmo';
}

/**
 * Character menu (when the user has characters), then roles (MMO), then
 * Confirm. Each step re-reads the series state so the summary stays current.
 */
export async function showNextStep(
  interaction: SeriesInteraction,
  event: EventRow,
  userId: number,
  picks: Picks,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const characters = picks.characterId
    ? []
    : await loadCharacters(event, userId, deps);
  if (characters.length > 0 && interaction.isButton())
    return showCharacterStep(interaction, event, userId, characters, deps);
  if (isMmo(event) && !picks.roles)
    return showRoleStep(interaction, event, userId, picks, deps);
  await showConfirm(interaction, event.id, userId, picks, deps);
}

async function showCharacterStep(
  interaction: ButtonInteraction,
  event: EventRow,
  userId: number,
  characters: CharacterDto[],
  deps: SeriesInteractionDeps,
): Promise<void> {
  const embed = await summaryEmbed(event.id, userId, deps);
  if (!embed) return noNights(interaction);
  await showCharacterSelect(interaction, {
    customIdPrefix: SERIES_BUTTON_IDS.CHARACTER,
    eventId: event.id,
    eventTitle: event.title,
    characters,
    emojiService: deps.emojiService,
    embed,
  });
}

async function showRoleStep(
  interaction: SeriesInteraction,
  event: EventRow,
  userId: number,
  picks: Picks,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const embed = await summaryEmbed(event.id, userId, deps);
  if (!embed) return noNights(interaction);
  await showRoleSelect(interaction, {
    customIdPrefix: SERIES_BUTTON_IDS.ROLE,
    eventId: event.id,
    characterId: picks.characterId ?? undefined,
    emojiService: deps.emojiService,
    embed,
  });
}

/**
 * The summary as an embed for the pick steps; null when nothing is joinable.
 * Built through the shared chrome (ROK-1477 AC4). The pick steps are an
 * ephemeral reply only the clicker sees, so it takes the reader-only `dm`
 * surface; `needs_you` because the reader still has a pick to make.
 */
async function summaryEmbed(
  eventId: number,
  userId: number,
  deps: SeriesInteractionDeps,
): Promise<DmEmbed | null> {
  const state = await deps.seriesSignupsService.getState(eventId, userId);
  if (state.joinableCount === 0) return null;
  return createDmEmbed({ state: 'needs_you', timestamp: false }).setDescription(
    formatJoinSummary(state),
  );
}

async function noNights(interaction: SeriesInteraction): Promise<void> {
  await interaction.editReply({
    content: 'No upcoming nights to join.',
    components: [],
    embeds: [],
  });
}

/** Summary + a Success "Join N nights" button carrying the picks. */
export async function showConfirm(
  interaction: SeriesInteraction,
  eventId: number,
  userId: number,
  picks: Picks,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const state = await deps.seriesSignupsService.getState(eventId, userId);
  if (state.joinableCount === 0) return noNights(interaction);
  const n = state.joinableCount;
  const confirm = new ButtonBuilder()
    .setCustomId(
      buildSeriesCustomId(
        SERIES_BUTTON_IDS.CONFIRM,
        eventId,
        picks.characterId,
        picks.roles,
      ),
    )
    .setLabel(`Join ${n} night${n === 1 ? '' : 's'}`)
    .setStyle(ButtonStyle.Success);
  await interaction.editReply({
    content: formatJoinSummary(state),
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirm)],
    embeds: [],
  });
}
