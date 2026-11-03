import { ConflictException, HttpException, type Logger } from '@nestjs/common';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { JoinSeriesDto } from '@raid-ledger/contract';
import type * as schema from '../../drizzle/schema';
import type { SeriesSignupsService } from '../../events/series-signups.service';
import type { SignupsService } from '../../events/signups.service';
import type { CharactersService } from '../../characters/characters.service';
import type { DiscordEmojiService } from '../services/discord-emoji.service';
import { findActiveMembership } from '../../events/series-signups.queries';
import { SERIES_ERRORS } from '../../events/series-signups-join.helpers';
import { SERIES_BUTTON_IDS } from '../series-signup/series-signup.constants';
import { findLinkedUser, fetchEvent } from './signup-interaction.helpers';
import {
  formatJoinedReply,
  type ParsedSeriesCustomId,
  type SeriesRole,
} from './series-signup-interaction.helpers';
import {
  NO_PICKS,
  showConfirm,
  showNextStep,
} from './series-signup-interaction.steps';

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

/** Plain ephemeral text with no components. */
async function replyText(
  interaction: SeriesInteraction,
  content: string,
): Promise<void> {
  await interaction.editReply({ content, components: [] });
}

/** An active member: "You're in for the series." + Leave. */
export async function replyAlreadyMember(
  interaction: SeriesInteraction,
  eventId: number,
): Promise<void> {
  await interaction.editReply({
    content: "You're in for the series.",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        buildLeaveButton(eventId),
      ),
    ],
    embeds: [],
  });
}

/** True for the 409 `join` throws for an existing member (incl. the 23505 race). */
function isAlreadyMember(error: unknown): boolean {
  return (
    error instanceof ConflictException &&
    error.message === SERIES_ERRORS.ALREADY_MEMBER
  );
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
  if (!event) return replyText(interaction, 'Event not found.');
  if (!event.recurrenceGroupId)
    return replyText(interaction, 'This event is not part of a series.');
  if (await findActiveMembership(deps.db, event.recurrenceGroupId, user.id))
    return replyAlreadyMember(interaction, eventId);
  await showNextStep(interaction, event, user.id, NO_PICKS, deps);
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
  if (!event) return replyText(interaction, 'Event not found.');
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

/**
 * Confirm button → `SeriesSignupsService.join` with the carried picks. A
 * repeat Confirm (already a member) gets "You're in for the series.", never
 * the raw 409 text.
 */
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
    if (isAlreadyMember(error))
      return replyAlreadyMember(interaction, parsed.eventId);
    await replyServiceError(interaction, error);
  }
}
