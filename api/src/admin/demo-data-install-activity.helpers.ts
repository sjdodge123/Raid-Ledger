/**
 * Demo data activity_log row builders (ROK-1116).
 *
 * Demo data install bypasses the SignupsService / EventsService paths that
 * normally call ActivityLogService.log(...). These pure builders produce the
 * activity_log inserts so demo events render proper timelines.
 */
import { inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

type Db = PostgresJsDatabase<typeof schema>;
type BatchInsert = (
  table: Parameters<Db['insert']>[0],
  rows: Record<string, unknown>[],
  onConflict?: 'doNothing',
) => Promise<unknown>;

type EventRow = Pick<
  typeof schema.events.$inferSelect,
  'id' | 'creatorId' | 'title'
>;

type SignupRow = Pick<
  typeof schema.eventSignups.$inferSelect,
  'eventId' | 'userId' | 'preferredRoles'
>;

export function buildEventCreatedActivityRows(
  events: EventRow[],
): Record<string, unknown>[] {
  return events.map((e) => ({
    entityType: 'event' as const,
    entityId: e.id,
    action: 'event_created' as const,
    actorId: e.creatorId,
    metadata: { title: e.title },
  }));
}

export function buildSignupAddedActivityRows(
  signups: SignupRow[],
): Record<string, unknown>[] {
  return signups
    .filter((s): s is SignupRow & { userId: number } => s.userId != null)
    .map((s) => {
      const roles = s.preferredRoles;
      return {
        entityType: 'event' as const,
        entityId: s.eventId,
        action: 'signup_added' as const,
        actorId: s.userId,
        metadata: { role: roles?.[0] ?? null },
      };
    });
}

/** Re-fetches creator_id post-reassignment, then bulk-inserts activity rows. */
export async function installActivityLog(
  db: Db,
  batchInsert: BatchInsert,
  createdEvents: (typeof schema.events.$inferSelect)[],
  createdSignups: (typeof schema.eventSignups.$inferSelect)[],
): Promise<void> {
  if (createdEvents.length === 0) return;
  const eventIds = createdEvents.map((e) => e.id);
  const finalEvents = await db
    .select({
      id: schema.events.id,
      creatorId: schema.events.creatorId,
      title: schema.events.title,
    })
    .from(schema.events)
    .where(inArray(schema.events.id, eventIds));
  const rows = [
    ...buildEventCreatedActivityRows(finalEvents),
    ...buildSignupAddedActivityRows(createdSignups),
  ];
  if (rows.length > 0) await batchInsert(schema.activityLog, rows);
}
