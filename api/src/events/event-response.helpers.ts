import { eq, and, ne, not, sql, asc, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  EventResponseDto,
} from '@raid-ledger/contract';
import type { EmbedEventData } from '../discord-bot/services/discord-embed.factory';

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

export function mapEventToResponse(
  row: EventRow,
  signupsPreview?: SignupsPreviewItem[],
): EventResponseDto {
  const { events: event, users: creator, games: game, signupCount } = row;

  const gameData = game
    ? {
        id: game.id,
        name: game.name,
        slug: game.slug,
        coverUrl: game.coverUrl,
        hasRoles: game.hasRoles,
      }
    : null;

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.duration[0].toISOString(),
    endTime: event.duration[1].toISOString(),
    creator: {
      id: creator?.id ?? 0,
      username: creator?.username ?? 'Unknown',
      avatar: creator?.avatar ?? null,
      discordId: creator?.discordId ?? null,
      customAvatarUrl: creator?.customAvatarUrl ?? null,
    },
    game: gameData,
    signupCount: Number(signupCount),
    signupsPreview,
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

export async function getSignupsPreviewForEvents(
  db: PostgresJsDatabase<typeof schema>,
  eventIds: number[],
  limit = 5,
): Promise<Map<number, SignupsPreviewItem[]>> {
  if (eventIds.length === 0) return new Map();

  const signups = await db
    .select({
      eventId: schema.eventSignups.eventId,
      userId: schema.users.id,
      discordId: schema.users.discordId,
      username: schema.users.username,
      avatar: schema.users.avatar,
      customAvatarUrl: schema.users.customAvatarUrl,
      signedUpAt: schema.eventSignups.signedUpAt,
    })
    .from(schema.eventSignups)
    .innerJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .where(inArray(schema.eventSignups.eventId, eventIds))
    .orderBy(asc(schema.eventSignups.signedUpAt));

  const userIds = [...new Set(signups.map((s) => s.userId))];

  const charactersData =
    userIds.length > 0
      ? await db
          .select({
            userId: schema.characters.userId,
            gameId: schema.characters.gameId,
            avatarUrl: schema.characters.avatarUrl,
          })
          .from(schema.characters)
          .where(inArray(schema.characters.userId, userIds))
      : [];

  const charactersByUser = new Map<
    number,
    { gameId: number; avatarUrl: string | null }[]
  >();
  for (const char of charactersData) {
    if (!charactersByUser.has(char.userId)) {
      charactersByUser.set(char.userId, []);
    }
    charactersByUser.get(char.userId)!.push({
      gameId: char.gameId,
      avatarUrl: char.avatarUrl,
    });
  }

  const result = new Map<number, SignupsPreviewItem[]>();
  for (const signup of signups) {
    if (!result.has(signup.eventId)) {
      result.set(signup.eventId, []);
    }
    const eventSignups = result.get(signup.eventId)!;
    if (eventSignups.length < limit) {
      const userCharacters = charactersByUser.get(signup.userId);
      eventSignups.push({
        id: signup.userId,
        discordId: signup.discordId ?? '',
        username: signup.username,
        avatar: signup.avatar,
        customAvatarUrl: signup.customAvatarUrl,
        characters: userCharacters,
      });
    }
  }

  return result;
}

export async function buildEmbedEventData(
  db: PostgresJsDatabase<typeof schema>,
  event: EventResponseDto,
  eventId: number,
): Promise<EmbedEventData> {
  const roleRows = await db
    .select({
      role: schema.rosterAssignments.role,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId))
    .groupBy(schema.rosterAssignments.role);

  const roleCounts: Record<string, number> = {};
  for (const row of roleRows) {
    if (row.role) roleCounts[row.role] = row.count;
  }

  const signupRows = await db
    .select({
      discordId: sql<
        string | null
      >`COALESCE(${schema.users.discordId}, ${schema.eventSignups.discordUserId})`,
      username: schema.users.username,
      role: schema.rosterAssignments.role,
      status: schema.eventSignups.status,
      preferredRoles: schema.eventSignups.preferredRoles,
      className: schema.characters.class,
    })
    .from(schema.eventSignups)
    .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
    .leftJoin(
      schema.rosterAssignments,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .leftJoin(
      schema.characters,
      eq(schema.eventSignups.characterId, schema.characters.id),
    )
    .where(eq(schema.eventSignups.eventId, eventId));

  const activeRows = signupRows.filter(
    (r) =>
      r.status !== 'declined' &&
      r.status !== 'roached_out' &&
      r.status !== 'departed',
  );
  const signupMentions = activeRows
    .filter((r) => r.discordId || r.username)
    .map((r) => ({
      discordId: r.discordId,
      username: r.username,
      role: r.role ?? null,
      preferredRoles: r.preferredRoles,
      status: r.status ?? null,
      className: r.className ?? null,
    }));

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    signupCount: activeRows.length,
    maxAttendees: event.maxAttendees,
    slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
    roleCounts,
    signupMentions,
    game: event.game
      ? { name: event.game.name, coverUrl: event.game.coverUrl }
      : null,
  };
}

export async function getVariantContext(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<{ gameVariant: string | null; region: string | null }> {
  const rows = await db
    .select({
      gameVariant: schema.characters.gameVariant,
      region: schema.characters.region,
    })
    .from(schema.eventSignups)
    .innerJoin(
      schema.characters,
      eq(schema.eventSignups.characterId, schema.characters.id),
    )
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        not(eq(schema.eventSignups.status, 'declined')),
        not(eq(schema.eventSignups.status, 'roached_out')),
        not(eq(schema.eventSignups.status, 'departed')),
      ),
    );

  if (rows.length === 0) {
    return { gameVariant: null, region: null };
  }

  const variantCounts = new Map<string, number>();
  const regionCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.gameVariant) {
      variantCounts.set(
        row.gameVariant,
        (variantCounts.get(row.gameVariant) ?? 0) + 1,
      );
    }
    if (row.region) {
      regionCounts.set(row.region, (regionCounts.get(row.region) ?? 0) + 1);
    }
  }

  let dominantVariant: string | null = null;
  let maxVariantCount = 0;
  for (const [variant, count] of variantCounts) {
    if (count > maxVariantCount) {
      dominantVariant = variant;
      maxVariantCount = count;
    }
  }

  let dominantRegion: string | null = null;
  let maxRegionCount = 0;
  for (const [region, count] of regionCounts) {
    if (count > maxRegionCount) {
      dominantRegion = region;
      maxRegionCount = count;
    }
  }

  return { gameVariant: dominantVariant, region: dominantRegion };
}
