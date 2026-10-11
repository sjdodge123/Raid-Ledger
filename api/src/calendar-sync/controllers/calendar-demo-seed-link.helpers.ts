/**
 * ROK-1596 W3: the body of `POST /admin/test/calendar/seed-link` (DEMO_MODE
 * only — the controller gates it). Writes one `calendar_event_links` row for
 * a user × event on the user's newest `demo-fake:` connection, so smoke specs
 * and UI test plans get a deterministic "On your Google Calendar" line
 * without waiting on the debounced write queue. A `synced` link points at a
 * real Fake copy in the dedicated calendar; `failed`/`suppressed` carry the
 * empty placeholder ids the undo path writes (E1).
 */
import { NotFoundException } from '@nestjs/common';
import { and, desc, eq, like } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { z } from 'zod';
import * as schema from '../../drizzle/schema';
import { FAKE_SUBJECT_PREFIX } from '../providers/testing/fake-calendar.provider';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import { decryptCalendarCredentials } from '../services/calendar-credentials.helpers';
import type { CalendarCredentials } from '../providers/calendar-provider.interface';
import {
  buildCopyInput,
  loadCopyEvent,
} from '../write/calendar-write-copy.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type Connection = typeof schema.calendarConnections.$inferSelect;

export const SeedLinkSchema = z
  .object({
    userId: z.number().int().positive(),
    eventId: z.number().int().positive(),
    state: z.enum(['synced', 'failed', 'suppressed']),
    /** Pin the link to this `demo-fake:` connection (must be the user's); default: their newest. */
    connectionId: z.number().int().positive().optional(),
  })
  .strict();
export type SeedLinkInput = z.infer<typeof SeedLinkSchema>;

interface LinkRef {
  calendarId: string;
  providerEventId: string;
  etag: string | null;
}

const PLACEHOLDER: LinkRef = {
  calendarId: '',
  providerEventId: '',
  etag: null,
};

async function fakeConnectionOf(
  db: Db,
  userId: number,
  connectionId?: number,
): Promise<Connection> {
  const t = schema.calendarConnections;
  const [conn] = await db
    .select()
    .from(t)
    .where(
      and(
        eq(t.userId, userId),
        like(t.accountSubject, `${FAKE_SUBJECT_PREFIX}%`),
        connectionId === undefined ? undefined : eq(t.id, connectionId),
      ),
    )
    .orderBy(desc(t.id))
    .limit(1);
  if (!conn)
    throw new NotFoundException('No demo-fake connection for that user');
  return conn;
}

/** The connection's dedicated Fake calendar, created if gone and persisted on the row. */
async function ensureDedicated(
  db: Db,
  fake: FakeCalendarProvider,
  creds: CalendarCredentials,
  conn: Connection,
): Promise<string> {
  const calendarId = await fake.ensureRaidLedgerCalendar(
    creds,
    conn.dedicatedCalendarId,
  );
  await db
    .update(schema.calendarConnections)
    .set({ dedicatedCalendarId: calendarId })
    .where(eq(schema.calendarConnections.id, conn.id));
  return calendarId;
}

/** Ensures the dedicated Fake calendar, then writes the copy into it. */
async function seedCopy(
  db: Db,
  fake: FakeCalendarProvider,
  clientUrl: string,
  conn: Connection,
  input: SeedLinkInput,
): Promise<LinkRef> {
  const event = await loadCopyEvent(db, input.eventId);
  if (!event) throw new NotFoundException('No such event');
  const creds = decryptCalendarCredentials(conn.credentialsEncrypted);
  const calendarId = await ensureDedicated(db, fake, creds, conn);
  const { eventId, userId } = input;
  const copy = buildCopyInput({
    clientUrl,
    eventId,
    userId,
    event,
    tentative: false,
    benched: false,
  });
  const ref = await fake.upsertEvent(creds, calendarId, copy, null);
  return {
    calendarId,
    providerEventId: ref.providerEventId,
    etag: ref.etag ?? null,
  };
}

export async function seedDemoLink(
  db: Db,
  fake: FakeCalendarProvider,
  clientUrl: string,
  input: SeedLinkInput,
): Promise<{ linkId: number }> {
  const conn = await fakeConnectionOf(db, input.userId, input.connectionId);
  const ref =
    input.state === 'synced'
      ? await seedCopy(db, fake, clientUrl, conn, input)
      : PLACEHOLDER;
  const values = { ...ref, state: input.state, lastErrorCode: null };
  const t = schema.calendarEventLinks;
  const [link] = await db
    .insert(t)
    .values({
      connectionId: conn.id,
      userId: input.userId,
      eventId: input.eventId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [t.connectionId, t.eventId, t.userId],
      set: { ...values, updatedAt: new Date() },
    })
    .returning({ id: t.id });
  if (!link) throw new Error('seed-link: upsert returned no row');
  return { linkId: link.id };
}
