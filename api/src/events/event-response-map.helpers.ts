/**
 * Helpers for mapping event DB rows to response DTOs.
 */
import type { EventResponseDto } from '@raid-ledger/contract';
import type * as schema from '../drizzle/schema';

type EventRow = {
  events: typeof schema.events.$inferSelect;
  users: typeof schema.users.$inferSelect | null;
  games: typeof schema.games.$inferSelect | null;
  signupCount: number;
};

type SignupsPreviewItem = {
  id: number;
  discordId: string;
  username: string;
  avatar: string | null;
  customAvatarUrl?: string | null;
  characters?: { gameId: number; avatarUrl: string | null }[];
};

/** Maps a game entity to its response shape, or null. */
function mapGame(
  game: typeof schema.games.$inferSelect | null,
): EventResponseDto['game'] {
  if (!game) return null;
  return {
    id: game.id,
    name: game.name,
    slug: game.slug,
    coverUrl: game.coverUrl,
    hasRoles: game.hasRoles,
  };
}

/** Maps a creator entity to its response shape. */
function mapCreator(
  creator: typeof schema.users.$inferSelect | null,
): EventResponseDto['creator'] {
  return {
    id: creator?.id ?? 0,
    username: creator?.username ?? 'Unknown',
    avatar: creator?.avatar ?? null,
    discordId: creator?.discordId ?? null,
    customAvatarUrl: creator?.customAvatarUrl ?? null,
  };
}

/** Maps event-level scalar fields to response. */
function mapEventFields(
  event: typeof schema.events.$inferSelect,
): Partial<EventResponseDto> {
  return {
    slotConfig: (event.slotConfig as EventResponseDto['slotConfig']) ?? null,
    maxAttendees: event.maxAttendees ?? null,
    autoUnbench: event.autoUnbench ?? true,
    contentInstances:
      (event.contentInstances as EventResponseDto['contentInstances']) ?? null,
    recurrenceGroupId: event.recurrenceGroupId ?? null,
    recurrenceRule:
      (event.recurrenceRule as EventResponseDto['recurrenceRule']) ?? null,
    reminder15min: event.reminder15min,
    reminder1hour: event.reminder1hour,
    reminder24hour: event.reminder24hour,
    cancelledAt: event.cancelledAt?.toISOString() ?? null,
    cancellationReason: event.cancellationReason ?? null,
    isAdHoc: event.isAdHoc,
    adHocStatus:
      (event.adHocStatus as 'live' | 'grace_period' | 'ended') ?? null,
    channelBindingId: event.channelBindingId ?? null,
    notificationChannelOverride: event.notificationChannelOverride ?? null,
    extendedUntil: event.extendedUntil?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/** Maps a full event DB row to an EventResponseDto. */
export function mapEventToResponse(
  row: EventRow,
  signupsPreview?: SignupsPreviewItem[],
): EventResponseDto {
  const { events: event, users: creator, games: game, signupCount } = row;
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.duration[0].toISOString(),
    endTime: event.duration[1].toISOString(),
    creator: mapCreator(creator),
    game: mapGame(game),
    signupCount: Number(signupCount),
    signupsPreview,
    ...mapEventFields(event),
  } as EventResponseDto;
}

/** Builds a lifecycle event payload from an EventResponseDto. */
export function buildLifecyclePayload(
  eventResponse: EventResponseDto,
): Record<string, unknown> {
  return {
    eventId: eventResponse.id,
    event: {
      id: eventResponse.id,
      title: eventResponse.title,
      description: eventResponse.description,
      startTime: eventResponse.startTime,
      endTime: eventResponse.endTime,
      signupCount: eventResponse.signupCount,
      maxAttendees: eventResponse.maxAttendees,
      slotConfig: eventResponse.slotConfig,
      game: eventResponse.game
        ? {
            name: eventResponse.game.name,
            coverUrl: eventResponse.game.coverUrl,
          }
        : null,
    },
    gameId: eventResponse.game?.id ?? null,
    recurrenceRule: eventResponse.recurrenceRule ?? null,
    recurrenceGroupId: eventResponse.recurrenceGroupId ?? null,
    creatorId: eventResponse.creator.id,
    isAdHoc: eventResponse.isAdHoc ?? false,
    notificationChannelOverride:
      eventResponse.notificationChannelOverride ?? null,
  };
}
