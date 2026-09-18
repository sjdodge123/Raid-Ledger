import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { ChannelResolverService } from '../services/channel-resolver.service';
import type { EmbedEventData } from '../services/discord-embed.factory';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';
import {
  EMBED_GAME_COLUMNS,
  toEmbedGame,
} from '../services/embed-game.helpers';
import { computeEmbedStateForData } from '../services/embed-state.helpers';

/**
 * Find all tracked Discord messages for this event in the given guild.
 * Returns an empty array if no records exist.
 *
 * Multiple records exist when an event embed has been forwarded or
 * unfurled into a second channel, creating an additional tracking row.
 */
export async function findTrackedMessages(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  guildId: string,
): Promise<(typeof schema.discordEventMessages.$inferSelect)[]> {
  return db
    .select()
    .from(schema.discordEventMessages)
    .where(
      and(
        eq(schema.discordEventMessages.eventId, eventId),
        eq(schema.discordEventMessages.guildId, guildId),
      ),
    );
}

/**
 * Build EmbedEventData with live roster/signup information.
 */
export async function buildEventData(
  db: PostgresJsDatabase<typeof schema>,
  event: typeof schema.events.$inferSelect,
  channelResolver: ChannelResolverService,
): Promise<EmbedEventData> {
  const signupMentions = await queryActiveSignups(db, event.id, event.gameId);
  const roleCounts = await queryRoleCounts(db, event.id);

  const eventData = assembleEventData(event, signupMentions, roleCounts);

  await enrichWithGameInfo(db, event, eventData);
  await enrichWithVoiceChannel(channelResolver, event, eventData);

  return eventData;
}

/** Query active signups with roster/character info. */
async function queryActiveSignups(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  gameId?: number | null,
): Promise<EmbedEventData['signupMentions']> {
  const signupRows = await querySignupRows(db, eventId, gameId);
  return signupRows
    .filter((r) => !isExcludedStatus(r.status))
    .filter((r) => r.discordId !== null || r.username !== null)
    .map(toSignupMention);
}

/** One signup row, as `signupRowColumns` selects it. */
type SignupRow = {
  discordId: string | null;
  username: string | null;
  displayName: string | null;
  discordUsername: string | null;
  userId: number | null;
  role: string | null;
  status: string | null;
  preferredRoles: string[] | null;
  characterClass: string | null;
  mainCharacterClass: string | null;
};

/**
 * Project a signup row onto the roster's view of it.
 *
 * ROK-1460: the roster renders names, so the display name travels alongside
 * the username it falls back to.
 *
 * @param row - The joined signup / user / character row.
 * @returns The roster entry the embed factory consumes.
 */
export function toSignupMention(
  row: SignupRow,
): NonNullable<EmbedEventData['signupMentions']>[number] {
  return {
    discordId: row.discordId,
    username: row.username,
    displayName: row.displayName,
    discordUsername: row.discordUsername,
    role: row.role ?? null,
    preferredRoles: row.preferredRoles,
    status: row.status ?? null,
    className: resolveCharacterClass(row),
  };
}

/** Resolve character class: direct character first, then main character fallback. */
export function resolveCharacterClass(row: {
  characterClass: string | null;
  userId: number | null;
  mainCharacterClass: string | null;
}): string | null {
  if (row.characterClass) return row.characterClass;
  if (row.userId && row.mainCharacterClass) return row.mainCharacterClass;
  return null;
}

/** Subquery: resolve main character class for a user, filtered by game (ROK-824, ROK-918). */
function mainCharClassSubquery(gameId?: number | null) {
  // No game on the event -> no class emoji. A gameless event must not borrow the
  // user's main character (WoW class) symbol (ROK).
  if (!gameId) return sql<string | null>`NULL`;
  return sql<string | null>`(
      SELECT c2.class FROM characters c2
      WHERE c2.user_id = ${schema.eventSignups.userId}
        AND c2.is_main = true
        AND c2.game_id = ${gameId}
      LIMIT 1
    )`;
}

/** Build the column selection for signup row queries (ROK-918: game-filtered classes). */
function signupRowColumns(gameId?: number | null) {
  // Gameless events surface no class (ELSE NULL); see mainCharClassSubquery (ROK).
  const charClass = gameId
    ? sql<
        string | null
      >`CASE WHEN ${schema.characters.gameId} = ${gameId} THEN ${schema.characters.class} ELSE NULL END`
    : sql<string | null>`NULL`;
  return {
    discordId: sql<
      string | null
    >`COALESCE(${schema.users.discordId}, ${schema.eventSignups.discordUserId})`,
    username: schema.users.username,
    displayName: schema.users.displayName,
    // ROK-1460 fix 9: names an unlinked Discord signup (no users row).
    discordUsername: schema.eventSignups.discordUsername,
    userId: schema.eventSignups.userId,
    role: schema.rosterAssignments.role,
    status: schema.eventSignups.status,
    preferredRoles: schema.eventSignups.preferredRoles,
    characterClass: charClass,
    mainCharacterClass: mainCharClassSubquery(gameId),
  };
}

/** Raw query for signup rows with joined roster/character data. */
async function querySignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  gameId?: number | null,
) {
  return db
    .select(signupRowColumns(gameId))
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
}

/** Check if a signup status should be excluded from active counts. */
function isExcludedStatus(status: string | null): boolean {
  return (
    status === 'declined' || status === 'roached_out' || status === 'departed'
  );
}

/** Query role counts from roster assignments. */
async function queryRoleCounts(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<Record<string, number>> {
  const roleRows = await db
    .select({
      role: schema.rosterAssignments.role,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        sql`${schema.eventSignups.status} != 'declined'`,
      ),
    )
    .groupBy(schema.rosterAssignments.role);

  const counts: Record<string, number> = {};
  for (const row of roleRows) {
    if (row.role) counts[row.role] = row.count;
  }
  return counts;
}

/** Assemble the core EmbedEventData object. */
function assembleEventData(
  event: typeof schema.events.$inferSelect,
  signupMentions: EmbedEventData['signupMentions'],
  roleCounts: Record<string, number>,
): EmbedEventData {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.duration[0].toISOString(),
    endTime: event.duration[1].toISOString(),
    signupCount: signupMentions?.length ?? 0,
    maxAttendees: event.maxAttendees,
    slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
    roleCounts,
    signupMentions,
  };
}

/** Enrich event data with game info if available. */
async function enrichWithGameInfo(
  db: PostgresJsDatabase<typeof schema>,
  event: typeof schema.events.$inferSelect,
  eventData: EmbedEventData,
): Promise<void> {
  if (!event.gameId) return;
  const [game] = await db
    .select(EMBED_GAME_COLUMNS)
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId))
    .limit(1);
  const projected = toEmbedGame(game);
  if (projected) eventData.game = projected;
}

/** Enrich event data with voice channel info. */
async function enrichWithVoiceChannel(
  channelResolver: ChannelResolverService,
  event: typeof schema.events.$inferSelect,
  eventData: EmbedEventData,
): Promise<void> {
  // ROK-1389: honor a voice override only when it is actually a voice channel.
  const voiceChannelId =
    await channelResolver.resolveVoiceChannelHonoringOverride(
      event.gameId,
      event.recurrenceGroupId,
      event.ephemeralVoiceChannelId,
      event.notificationChannelOverride,
    );
  if (voiceChannelId) {
    eventData.voiceChannelId = voiceChannelId;
  }
}

/**
 * Compute the correct embed state based on event timing and roster fill.
 *
 * State transitions:
 * - POSTED/FILLING -> FULL: when signup count reaches maxAttendees
 * - FULL -> FILLING: when someone withdraws and count drops below max
 * - Any -> IMMINENT: when event is < 2 hours away
 * - IMMINENT -> LIVE: when event start time is reached
 * - LIVE -> COMPLETED: when event end time is reached
 */
export function computeEmbedState(
  event: typeof schema.events.$inferSelect,
  eventData: EmbedEventData,
): EmbedState {
  // ROK-1622: the rules live in `embed-state.helpers` so the initial post
  // (EmbedPosterService) and this sync pass cannot disagree on the colour.
  // The row is authoritative for the window: `eventData` is rebuilt from it,
  // but only the row carries `extendedUntil` (ROK-1183).
  return computeEmbedStateForData(eventData, {
    startTime: event.duration[0],
    endTime: event.extendedUntil ?? event.duration[1],
  });
}
