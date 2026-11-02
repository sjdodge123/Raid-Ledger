import { HttpException, type Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterDto, JoinSeriesDto } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import type { SeriesSignupsService } from '../../events/series-signups.service';
import type { SignupsService } from '../../events/signups.service';
import type { CharactersService } from '../../characters/characters.service';
import type { DiscordEmojiService } from '../services/discord-emoji.service';
import { findActiveMembership } from '../../events/series-signups.queries';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';
import {
  showCharacterSelect,
  showRoleSelect,
} from '../utils/signup-dropdown-builders';
import { findLinkedUser, fetchEvent } from './signup-interaction.helpers';
import {
  buildSeriesCustomId,
  formatJoinSummary,
  formatJoinedReply,
  type ParsedSeriesCustomId,
  type SeriesRole,
} from './series-signup-interaction.helpers';

/** Dependencies of the series signup interaction handlers (ROK-1728). */
export interface SeriesInteractionDeps {
  db: PostgresJsDatabase<typeof schema>;
  logger: Pick<Logger, 'warn' | 'log' | 'error'>;
  seriesSignupsService: Pick<
    SeriesSignupsService,
    'getState' | 'join' | 'leave'
  >;
  signupsService: Pick<SignupsService, 'cancelByDiscordUser'>;
  charactersService: Pick<CharactersService, 'findAllForUser'>;
  emojiService: DiscordEmojiService;
}

/** Any component interaction the series flow replies to. */
export type SeriesInteraction = ButtonInteraction | StringSelectMenuInteraction;

type Picks = { characterId: string | null; roles: SeriesRole[] | null };
type EventRow = typeof schema.events.$inferSelect;

export const LINK_ACCOUNT_COPY =
  'Link your Raid Ledger account to join a series.';

/** Ephemeral reply for a Discord user with no linked Raid Ledger account (OQ-5). */
export async function replyLinkAccount(
  interaction: SeriesInteraction,
  eventId: number,
): Promise<void> {
  const clientUrl = process.env.CLIENT_URL ?? '';
  const components = clientUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setLabel('Open Raid Ledger')
            .setStyle(ButtonStyle.Link)
            .setURL(`${clientUrl}/events/${eventId}`),
        ),
      ]
    : [];
  await interaction.editReply({ content: LINK_ACCOUNT_COPY, components });
}

/** One Danger "Leave series" button (`series_leave:<id>`). */
export function buildLeaveButton(eventId: number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(`${SERIES_BUTTON_IDS.LEAVE}:${eventId}`)
    .setLabel('Leave series')
    .setStyle(ButtonStyle.Danger);
}

/** Reply with an HttpException's message; rethrow anything else. */
export async function replyServiceError(
  interaction: SeriesInteraction,
  error: unknown,
): Promise<void> {
  if (!(error instanceof HttpException)) throw error;
  await interaction.editReply({ content: error.message, components: [] });
}

/** Series button on an embed: link check → member check → first pick step. */
export async function handleJoinSeries(
  interaction: ButtonInteraction,
  eventId: number,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return replyLinkAccount(interaction, eventId);
  const event = await fetchEvent(eventId, deps);
  if (!event)
    return void (await interaction.editReply({ content: 'Event not found.' }));
  if (!event.recurrenceGroupId) {
    await interaction.editReply({
      content: 'This event is not part of a series.',
    });
    return;
  }
  if (await findActiveMembership(deps.db, event.recurrenceGroupId, user.id)) {
    await interaction.editReply({
      content: "You're in for the series.",
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          buildLeaveButton(eventId),
        ),
      ],
    });
    return;
  }
  await showNextStep(
    interaction,
    event,
    user.id,
    { characterId: null, roles: null },
    deps,
  );
}

/** Character menu pick → roles (MMO) or Confirm. */
export async function handleSeriesCharacterPick(
  interaction: StringSelectMenuInteraction,
  parsed: ParsedSeriesCustomId,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return replyLinkAccount(interaction, parsed.eventId);
  const event = await fetchEvent(parsed.eventId, deps);
  if (!event)
    return void (await interaction.editReply({ content: 'Event not found.' }));
  const picks = { characterId: interaction.values[0] ?? null, roles: null };
  await showNextStep(interaction, event, user.id, picks, deps);
}

/** Role menu pick → Confirm carrying character + roles. */
export async function handleSeriesRolePick(
  interaction: StringSelectMenuInteraction,
  parsed: ParsedSeriesCustomId,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return replyLinkAccount(interaction, parsed.eventId);
  const roles = interaction.values.filter(
    (v): v is SeriesRole => v === 'tank' || v === 'healer' || v === 'dps',
  );
  const picks = {
    characterId: parsed.characterId,
    roles: roles.length ? roles : null,
  };
  await showConfirm(interaction, parsed.eventId, user.id, picks, deps);
}

/** Confirm button → `SeriesSignupsService.join` with the carried picks. */
export async function handleSeriesConfirm(
  interaction: SeriesInteraction,
  parsed: ParsedSeriesCustomId,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const user = await findLinkedUser(interaction.user.id, deps);
  if (!user) return replyLinkAccount(interaction, parsed.eventId);
  const dto: JoinSeriesDto = {
    ...(parsed.characterId ? { characterId: parsed.characterId } : {}),
    ...(parsed.roles ? { preferredRoles: parsed.roles } : {}),
  };
  try {
    const res = await deps.seriesSignupsService.join(
      parsed.eventId,
      user.id,
      dto,
    );
    await interaction.editReply({
      content: formatJoinedReply(res),
      components: [],
    });
  } catch (error) {
    await replyServiceError(interaction, error);
  }
}

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

/** Character menu (when the user has characters), then roles (MMO), then Confirm. */
async function showNextStep(
  interaction: SeriesInteraction,
  event: EventRow,
  userId: number,
  picks: Picks,
  deps: SeriesInteractionDeps,
): Promise<void> {
  const characters = picks.characterId
    ? []
    : await loadCharacters(event, userId, deps);
  if (characters.length > 0 && interaction.isButton()) {
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
    return;
  }
  if (isMmo(event) && !picks.roles) {
    const embed = await summaryEmbed(event.id, userId, deps);
    if (!embed) return noNights(interaction);
    await showRoleSelect(interaction, {
      customIdPrefix: SERIES_BUTTON_IDS.ROLE,
      eventId: event.id,
      characterId: picks.characterId ?? undefined,
      emojiService: deps.emojiService,
      embed,
    });
    return;
  }
  await showConfirm(interaction, event.id, userId, picks, deps);
}

/** The summary as an embed for the pick steps; null when nothing is joinable. */
async function summaryEmbed(
  eventId: number,
  userId: number,
  deps: SeriesInteractionDeps,
): Promise<EmbedBuilder | null> {
  const state = await deps.seriesSignupsService.getState(eventId, userId);
  if (state.joinableCount === 0) return null;
  return new EmbedBuilder().setDescription(formatJoinSummary(state));
}

async function noNights(interaction: SeriesInteraction): Promise<void> {
  await interaction.editReply({
    content: 'No upcoming nights to join.',
    components: [],
    embeds: [],
  });
}

/** Summary + a Success "Join N nights" button carrying the picks. */
async function showConfirm(
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
