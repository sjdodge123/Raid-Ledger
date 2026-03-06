import { eq, and, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { ChannelResolverService } from '../services/channel-resolver.service';
import type { EmbedEventData } from '../services/discord-embed.factory';
import { EMBED_STATES, type EmbedState } from '../discord-bot.constants';

/** Two hours in milliseconds — threshold for IMMINENT state. */
const IMMINENT_THRESHOLD_MS = 2 * 60 * 60 * 1000;

/**
 * Find the tracked Discord message for this event in the given guild.
 * Returns null if no record exists.
 */
export async function findTrackedMessage(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  guildId: string,
): Promise<typeof schema.discordEventMessages.$inferSelect | null> {
  const [record] = await db
    .select()
    .from(schema.discordEventMessages)
    .where(
      and(
        eq(schema.discordEventMessages.eventId, eventId),
        eq(schema.discordEventMessages.guildId, guildId),
      ),
    )
    .limit(1);
  return record ?? null;
}

/**
 * Build EmbedEventData with live roster/signup information.
 */
export async function buildEventData(
  db: PostgresJsDatabase<typeof schema>,
  event: typeof schema.events.$inferSelect,
  channelResolver: ChannelResolverService,
): Promise<EmbedEventData> {
  const signupMentions = await queryActiveSignups(db, event.id);
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
): Promise<EmbedEventData['signupMentions']> {
  const signupRows = await querySignupRows(db, eventId);
  return signupRows
    .filter((r) => !isExcludedStatus(r.status))
    .filter((r) => r.discordId !== null || r.username !== null)
    .map((r) => ({
      discordId: r.discordId,
      username: r.username,
      role: r.role ?? null,
      preferredRoles: r.preferredRoles,
      status: r.status ?? null,
      className: r.className ?? null,
    }));
}

/** Raw query for signup rows with joined roster/character data. */
async function querySignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
) {
  return db
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
    .select({ name: schema.games.name, coverUrl: schema.games.coverUrl })
    .from(schema.games)
    .where(eq(schema.games.id, event.gameId))
    .limit(1);
  if (game) {
    eventData.game = { name: game.name, coverUrl: game.coverUrl };
  }
}

/** Enrich event data with voice channel info. */
async function enrichWithVoiceChannel(
  channelResolver: ChannelResolverService,
  event: typeof schema.events.$inferSelect,
  eventData: EmbedEventData,
): Promise<void> {
  const voiceChannelId =
    event.notificationChannelOverride ??
    (await channelResolver.resolveVoiceChannelForScheduledEvent(
      event.gameId,
      event.recurrenceGroupId,
    ));
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
  const now = Date.now();
  const startTime = event.duration[0].getTime();
  const endTime = event.extendedUntil
    ? event.extendedUntil.getTime()
    : event.duration[1].getTime();

  if (now >= endTime) return EMBED_STATES.COMPLETED;
  if (now >= startTime) return EMBED_STATES.LIVE;
  if (startTime - now <= IMMINENT_THRESHOLD_MS) return EMBED_STATES.IMMINENT;

  return computeCapacityState(event, eventData);
}

/** Compute capacity-based state (FULL, FILLING, or POSTED). */
function computeCapacityState(
  event: typeof schema.events.$inferSelect,
  eventData: EmbedEventData,
): EmbedState {
  if (event.maxAttendees && eventData.signupCount >= event.maxAttendees) {
    return EMBED_STATES.FULL;
  }
  const totalSlots = getTotalSlotsFromConfig(eventData.slotConfig);
  if (totalSlots > 0 && eventData.signupCount >= totalSlots) {
    return EMBED_STATES.FULL;
  }
  return eventData.signupCount > 0 ? EMBED_STATES.FILLING : EMBED_STATES.POSTED;
}

/** Compute total player slots from slotConfig. Returns 0 if no config. */
function getTotalSlotsFromConfig(
  slotConfig: EmbedEventData['slotConfig'],
): number {
  if (!slotConfig) return 0;
  if (slotConfig.type === 'mmo') {
    return (
      (slotConfig.tank ?? 0) +
      (slotConfig.healer ?? 0) +
      (slotConfig.dps ?? 0) +
      (slotConfig.flex ?? 0)
    );
  }
  return slotConfig.player ?? 0;
}
