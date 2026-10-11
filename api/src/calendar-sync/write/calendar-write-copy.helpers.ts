/**
 * ROK-1596 D4: what a Raid Ledger copy of an event says. Title from the
 * event (the adapter adds "(Tentative) " / "(Bench) "), the event link, and a fixed
 * "Added by Raid Ledger" line — never member names or notes (privacy, L5).
 * Bounds come from the zone-less `events.duration` tsrange (UTC wall clock).
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { parseTimestampUtc, utcIsoText } from '../../drizzle/timestamp-utils';
import type { CopyEventInput } from '../providers/calendar-provider.interface';
import { buildCopyId, deriveInstanceId } from '../providers/rl-copy-id.helpers';

type Db = PostgresJsDatabase<typeof schema>;

/** The fixed second line of every copy's description. */
export const COPY_FOOTER = 'Added by Raid Ledger';

export interface CopyEventRow {
  title: string;
  cancelled: boolean;
  start: Date;
  end: Date;
}

/** The event fields a copy needs; null when the row is gone. */
export async function loadCopyEvent(
  db: Db,
  eventId: number,
): Promise<CopyEventRow | null> {
  const [row] = await db
    .select({
      title: schema.events.title,
      cancelledAt: schema.events.cancelledAt,
      start: utcIsoText(sql`lower(${schema.events.duration})`),
      end: utcIsoText(sql`upper(${schema.events.duration})`),
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!row) return null;
  return {
    title: row.title,
    cancelled: row.cancelledAt !== null,
    start: parseTimestampUtc(row.start),
    end: parseTimestampUtc(row.end),
  };
}

/** The user's signup status for the event; null when there is no signup. */
export async function loadSignupStatus(
  db: Db,
  eventId: number,
  userId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ status: schema.eventSignups.status })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return row?.status ?? null;
}

/**
 * F11: true when the user's signup sits on the bench. Bench is a roster
 * assignment (`roster_assignments.role = 'bench'`), not a signup status.
 */
export async function loadSignupBenched(
  db: Db,
  eventId: number,
  userId: number,
): Promise<boolean> {
  const ra = schema.rosterAssignments;
  const [row] = await db
    .select({ id: ra.id })
    .from(ra)
    .innerJoin(schema.eventSignups, eq(schema.eventSignups.id, ra.signupId))
    .where(
      and(
        eq(ra.eventId, eventId),
        eq(ra.role, 'bench'),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** `<clientUrl>/events/<id>` (trailing slashes on the base dropped). */
export function eventPageUrl(clientUrl: string, eventId: number): string {
  return `${clientUrl.replace(/\/+$/, '')}/events/${eventId}`;
}

export interface CopyInputSource {
  clientUrl: string;
  eventId: number;
  userId: number;
  event: CopyEventRow;
  tentative: boolean;
  benched: boolean;
}

/** The provider-neutral copy (D4); the copy id stamps this instance (§5). */
export function buildCopyInput(src: CopyInputSource): CopyEventInput {
  const url = eventPageUrl(src.clientUrl, src.eventId);
  const instanceId = deriveInstanceId(new URL(src.clientUrl).host);
  return {
    copyId: buildCopyId({
      instanceId,
      eventId: src.eventId,
      userId: src.userId,
    }),
    title: src.event.title,
    description: `${url}\n\n${COPY_FOOTER}`,
    url,
    start: src.event.start,
    end: src.event.end,
    tentative: src.tentative,
    benched: src.benched,
  };
}
