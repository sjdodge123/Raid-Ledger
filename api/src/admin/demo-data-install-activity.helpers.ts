/**
 * Demo data activity_log row builders (ROK-1116).
 *
 * Demo data install bypasses the SignupsService / EventsService paths that
 * normally call ActivityLogService.log(...). These pure builders produce the
 * activity_log inserts so demo events render proper timelines.
 */
import * as schema from '../drizzle/schema';

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
      const roles = s.preferredRoles as string[] | null;
      return {
        entityType: 'event' as const,
        entityId: s.eventId,
        action: 'signup_added' as const,
        actorId: s.userId,
        metadata: { role: roles?.[0] ?? null },
      };
    });
}
