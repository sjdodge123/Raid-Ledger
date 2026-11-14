/**
 * Helpers for building Discord embed event data.
 */
import { eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { EventResponseDto } from '@raid-ledger/contract';
import type { ModuleRef } from '@nestjs/core';
import type { EmbedEventData } from '../discord-bot/services/discord-embed.factory';
import { toEmbedGame } from '../discord-bot/services/embed-game.helpers';
import {
  applyEmbedVoice,
  type EmbedVoiceDeps,
} from '../discord-bot/services/embed-voice.helpers';
import { getEphemeralVoiceState } from '../discord-bot/services/ephemeral-voice.db-helpers';
import { ChannelResolverService } from '../discord-bot/services/channel-resolver.service';
import type { PlannedVoiceSettingsSource } from '../discord-bot/services/planned-ephemeral-voice.helpers';

const INACTIVE_STATUSES = ['declined', 'roached_out', 'departed'];

/** Queries role assignment counts for an event. */
async function queryRoleCounts(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      role: schema.rosterAssignments.role,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId))
    .groupBy(schema.rosterAssignments.role);
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.role) result[row.role] = row.count;
  }
  return result;
}

/**
 * Class column for the signup query. Characters are game-specific, so only
 * surface a class (and therefore a class emoji) when the event has a game AND
 * the signed-up character belongs to it; otherwise a gameless event would show
 * the user's WoW class symbol (ROK).
 */
function classNameColumn(gameId: number | null) {
  return gameId
    ? sql<
        string | null
      >`CASE WHEN ${schema.characters.gameId} = ${gameId} THEN ${schema.characters.class} ELSE NULL END`
    : sql<string | null>`NULL`;
}

/** Queries signup rows with joined user/roster/character data. */
async function querySignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  gameId: number | null,
) {
  return db
    .select({
      discordId: sql<
        string | null
      >`COALESCE(${schema.users.discordId}, ${schema.eventSignups.discordUserId})`,
      username: schema.users.username,
      // ROK-1460: the roster renders names, and prefers this one — keep it in
      // step with embed-sync.helpers::signupRowColumns.
      displayName: schema.users.displayName,
      // ROK-1460 fix 9: names an unlinked Discord signup (no users row).
      discordUsername: schema.eventSignups.discordUsername,
      role: schema.rosterAssignments.role,
      status: schema.eventSignups.status,
      preferredRoles: schema.eventSignups.preferredRoles,
      runningLateAt: schema.eventSignups.runningLateAt,
      className: classNameColumn(gameId),
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

/** Filters and maps signup rows to mention entries for embeds. */
function buildSignupMentions(
  signupRows: Awaited<ReturnType<typeof querySignupRows>>,
): NonNullable<EmbedEventData['signupMentions']> {
  return signupRows
    .filter((r) => !INACTIVE_STATUSES.includes(r.status ?? ''))
    .filter((r) => r.discordId || r.username)
    .map((r) => ({
      discordId: r.discordId,
      username: r.username,
      displayName: r.displayName,
      discordUsername: r.discordUsername,
      role: r.role ?? null,
      preferredRoles: r.preferredRoles,
      status: r.status ?? null,
      className: r.className ?? null,
      runningLate: r.runningLateAt != null,
    }));
}

/**
 * The voice deps for `buildEmbedEventData`, resolved lazily: the channel
 * resolver lives in the Discord bot module, which imports the events module,
 * so it is looked up at call time. Undefined when it is not registered (a
 * unit-test module) — the embed then has no voice line, as before.
 */
export function embedVoiceDepsFrom(
  providers: Pick<ModuleRef, 'get'>,
  settings: PlannedVoiceSettingsSource,
): EmbedVoiceDeps | undefined {
  try {
    const channelResolver = providers.get(ChannelResolverService, {
      strict: false,
    });
    return { settings, channelResolver };
  } catch {
    return undefined;
  }
}

/**
 * Builds the full embed event data for Discord rendering. With `voice` deps the
 * result also carries the shared embed voice decision (`applyEmbedVoice`: the
 * planned temporary channel, else the voice link), so every interactive writer
 * (signup buttons, unfurls, share) renders the same voice line as the poster
 * and the sync processor instead of wiping it.
 */
export async function buildEmbedEventData(
  db: PostgresJsDatabase<typeof schema>,
  event: EventResponseDto,
  eventId: number,
  voice?: EmbedVoiceDeps,
): Promise<EmbedEventData> {
  const data = await buildBaseEmbedEventData(db, event, eventId);
  if (!voice) return data;
  await applyEmbedVoice(voice, data, {
    gameId: event.game?.id ?? null,
    recurrenceGroupId: event.recurrenceGroupId ?? null,
    notificationChannelOverride: event.notificationChannelOverride ?? null,
    ephemeral: await getEphemeralVoiceState(db, eventId),
  });
  return data;
}

/** The embed data without the voice line (roster, counts, game). */
async function buildBaseEmbedEventData(
  db: PostgresJsDatabase<typeof schema>,
  event: EventResponseDto,
  eventId: number,
): Promise<EmbedEventData> {
  const [roleCounts, signupRows] = await Promise.all([
    queryRoleCounts(db, eventId),
    querySignupRows(db, eventId, event.game?.id ?? null),
  ]);
  const activeRows = signupRows.filter(
    (r) => !INACTIVE_STATUSES.includes(r.status ?? ''),
  );
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    signupCount: activeRows.length,
    ...(event.maxAttendees !== undefined
      ? { maxAttendees: event.maxAttendees }
      : {}),
    ...(event.slotConfig !== undefined
      ? {
          slotConfig: event.slotConfig as NonNullable<
            EmbedEventData['slotConfig']
          > | null,
        }
      : {}),
    roleCounts,
    signupMentions: buildSignupMentions(signupRows),
    // ROK-1460: the shared seam keeps `id` on the projection, so the six
    // interactive writers render the same title link as the sync processor.
    game: toEmbedGame(event.game),
    // ROK-1728: a series night renders the Join Series row.
    recurrenceGroupId: event.recurrenceGroupId ?? null,
  };
}
