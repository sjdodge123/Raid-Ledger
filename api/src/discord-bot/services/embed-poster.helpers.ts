import { eq, and, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { EmbedEventData } from './discord-embed.factory';

/**
 * Check for an existing embed record for idempotency.
 *
 * LIMIT 1 is intentional here (ROK-1030 audit): the embed-poster only needs to
 * know whether *any* tracking row exists for this event+guild. If one exists, it
 * edits that message in-place rather than posting a duplicate. When multiple rows
 * exist (forwarded/unfurled/shared embeds), the embed-sync processor — which
 * uses `findTrackedMessages()` to fetch *all* rows — is responsible for keeping
 * every copy in sync.
 *
 * If `replaceDeletedEmbed()` fires (the found message was deleted from Discord),
 * only the single returned record is updated. Other tracking rows for the same
 * event are left for the sync processor to handle on the next queue tick.
 */
export async function findExistingEmbedRecord(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  guildId: string,
): Promise<{ id: string; channelId: string; messageId: string } | null> {
  const [record] = await db
    .select({
      id: schema.discordEventMessages.id,
      channelId: schema.discordEventMessages.channelId,
      messageId: schema.discordEventMessages.messageId,
    })
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

/** Row shape returned by signup queries. */
export interface SignupRow {
  discordId: string | null;
  username: string | null;
  role: string | null;
  status: string | null;
  preferredRoles: string[] | null;
  className: string | null;
}

/** Query active signups with roster/user/character data for an event. */
export async function querySignupRows(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<SignupRow[]> {
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

/** Query per-role signup counts for an event. */
export async function queryRoleCounts(
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

/** Build signup mentions from active signup rows. */
export function buildSignupMentions(
  rows: SignupRow[],
): EmbedEventData['signupMentions'] {
  return rows
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

/** Filter out declined/roached/departed signups. */
export function filterActiveSignups<T extends { status: string | null }>(
  rows: T[],
): T[] {
  return rows.filter(
    (r) =>
      r.status !== 'declined' &&
      r.status !== 'roached_out' &&
      r.status !== 'departed',
  );
}

/** Check if an error is a Discord "Unknown Message" (10008) error. */
export function isUnknownMessageError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Unknown Message') ||
      (error as Error & { code?: number }).code === 10008)
  );
}
