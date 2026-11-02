/**
 * Re-join after leave (ROK-1728 Q6): which declined nights a re-join may
 * sign up again. Computed from existing data — the user's last ended
 * membership and the `series_left` audit that lists the nights it cancelled.
 */
import { and, desc, eq, gt, inArray, ne, notInArray, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';

const ms = schema.seriesSignups;
const al = schema.activityLog;

/** Series audit actions logged on an anchor night; not a per-night action. */
const SERIES_ACTIONS = ['series_joined', 'series_left'];

/** The user's most recently ended membership of the group, if any. */
async function findLastEndedMembership(
  db: Tx,
  groupId: string,
  userId: number,
): Promise<{ id: number; endedReason: string | null } | undefined> {
  const [row] = await db
    .select({ id: ms.id, endedReason: ms.endedReason })
    .from(ms)
    .where(
      and(
        eq(ms.recurrenceGroupId, groupId),
        eq(ms.userId, userId),
        ne(ms.status, 'active'),
      ),
    )
    .orderBy(desc(ms.endedAt), desc(ms.id))
    .limit(1);
  return row;
}

/** `metadata.cancelledEventIds` of a `series_left` row (`[]` when absent). */
export function cancelledEventIdsOf(metadata: unknown): number[] {
  if (typeof metadata !== 'object' || metadata === null) return [];
  if (!('cancelledEventIds' in metadata)) return [];
  const value: unknown = metadata.cancelledEventIds;
  if (!Array.isArray(value)) return [];
  return value.filter((v: unknown): v is number => Number.isInteger(v));
}

/**
 * The `series_left` audit of one membership: cancelled nights + its row id.
 * Leave writes it AFTER its per-night `signup_cancelled` rows.
 */
async function findLeaveAudit(
  db: Tx,
  membershipId: number,
  userId: number,
): Promise<{ eventIds: number[]; auditId: number } | undefined> {
  const [row] = await db
    .select({ id: al.id, metadata: al.metadata })
    .from(al)
    .where(
      and(
        eq(al.action, 'series_left'),
        eq(al.actorId, userId),
        sql`${al.metadata}->>'seriesSignupId' = ${String(membershipId)}`,
      ),
    )
    .orderBy(desc(al.id))
    .limit(1);
  if (!row) return undefined;
  return { eventIds: cancelledEventIdsOf(row.metadata), auditId: row.id };
}

/**
 * Nights the user acted on themselves after the leave audit (their own
 * decision). Ordered by the serial id, not `created_at`: a JS Date truncates
 * the µs timestamp, so a cancel in the leave's millisecond would read as later.
 */
async function findNightsTouchedSince(
  db: Tx,
  userId: number,
  eventIds: number[],
  afterAuditId: number,
): Promise<Set<number>> {
  if (eventIds.length === 0) return new Set();
  const rows = await db
    .select({ eventId: al.entityId })
    .from(al)
    .where(
      and(
        eq(al.entityType, 'event'),
        eq(al.actorId, userId),
        inArray(al.entityId, eventIds),
        notInArray(al.action, SERIES_ACTIONS),
        gt(al.id, afterAuditId),
      ),
    );
  return new Set(rows.map((r) => r.eventId));
}

/**
 * Nights a re-join may sign up again (Q6): the nights the user's LAST
 * membership of the group cancelled when they left it, minus any night they
 * touched on their own afterwards. A night declined before or outside the
 * series is never in the leave's list, so it stays declined (D4, AC2c).
 */
export async function findRevivableEventIds(
  db: Tx,
  groupId: string,
  userId: number,
): Promise<Set<number>> {
  const last = await findLastEndedMembership(db, groupId, userId);
  if (!last || last.endedReason !== 'user_left') return new Set();
  const audit = await findLeaveAudit(db, last.id, userId);
  if (!audit) return new Set();
  const touched = await findNightsTouchedSince(
    db,
    userId,
    audit.eventIds,
    audit.auditId,
  );
  return new Set(audit.eventIds.filter((id) => !touched.has(id)));
}
