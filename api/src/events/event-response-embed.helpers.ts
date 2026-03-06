/**
 * Helpers for building Discord embed event data.
 */
import { eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { EventResponseDto } from '@raid-ledger/contract';
import type { EmbedEventData } from '../discord-bot/services/discord-embed.factory';

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

/** Queries signup rows with joined user/roster/character data. */
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

/** Filters and maps signup rows to mention entries for embeds. */
function buildSignupMentions(
  signupRows: Awaited<ReturnType<typeof querySignupRows>>,
): EmbedEventData['signupMentions'] {
  return signupRows
    .filter((r) => !INACTIVE_STATUSES.includes(r.status ?? ''))
    .filter((r) => r.discordId || r.username)
    .map((r) => ({
      discordId: r.discordId,
      username: r.username,
      role: r.role ?? null,
      preferredRoles: r.preferredRoles,
      status: r.status ?? null,
      className: r.className ?? null,
    }));
}

/** Builds the full embed event data for Discord rendering. */
export async function buildEmbedEventData(
  db: PostgresJsDatabase<typeof schema>,
  event: EventResponseDto,
  eventId: number,
): Promise<EmbedEventData> {
  const [roleCounts, signupRows] = await Promise.all([
    queryRoleCounts(db, eventId),
    querySignupRows(db, eventId),
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
    maxAttendees: event.maxAttendees,
    slotConfig: event.slotConfig as EmbedEventData['slotConfig'],
    roleCounts,
    signupMentions: buildSignupMentions(signupRows),
    game: event.game
      ? { name: event.game.name, coverUrl: event.game.coverUrl }
      : null,
  };
}
