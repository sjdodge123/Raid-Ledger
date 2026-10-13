/**
 * ROK-1593 §3.6: `POST /admin/test/calendar/seed-busy` — DEMO_MODE only.
 *
 * Writes foreign busy blocks for one connection straight into
 * `calendar_busy_blocks` (no queue, deterministic for the fleet plan and
 * ROK-1595's Playwright) AND into the Fake's `primary` calendar for THIS
 * connection's grant only, so a later sync of the row (cron, kill switch back
 * on, `POST …/sync`) reads the same blocks instead of erasing them — and a
 * sync of any other connection never sees them. `readAccess` optionally flips the
 * row's read grant: `granted` → read on, `active`; `missing` → read off.
 * Every seed stamps `last_synced_at` (`SEEDED_SYNC_AGE_MS` ago).
 * ROK-1595 G-2: `derive: true` then runs the PR-B away-day derive for the
 * owner inline (the function the `derive` job calls), so all-day blocks
 * become `source='calendar'` absences before the response.
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import type { BusyBlock } from '../providers/calendar-provider.interface';
import { decryptCalendarCredentials } from '../services/calendar-credentials.helpers';
import { MANUAL_SYNC_THROTTLE_MS } from '../services/calendar-read-settings.helpers';
import {
  runCalendarDerive,
  type CalendarDeriveResult,
} from '../read/calendar-away-persist.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const SeedBusyBlockSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    allDay: z.boolean().optional(),
    firstDate: LocalDateSchema.optional(),
    lastDate: LocalDateSchema.optional(),
  })
  .strict()
  .refine((b) => Date.parse(b.end) > Date.parse(b.start), 'end <= start')
  .refine(
    (b) => (b.allDay === true) === Boolean(b.firstDate && b.lastDate),
    'all-day blocks need firstDate + lastDate (and only they)',
  );

export const SeedBusySchema = z
  .object({
    connectionId: z.number().int().positive(),
    blocks: z.array(SeedBusyBlockSchema).min(1).max(100),
    readAccess: z.enum(['granted', 'missing']).optional(),
    derive: z.boolean().optional(),
  })
  .strict();
export type SeedBusyInput = z.infer<typeof SeedBusySchema>;

type SeedBlock = SeedBusyInput['blocks'][number];

/**
 * ROK-1595: the `last_synced_at` a seed stamps, just past the manual-sync
 * throttle — the page reads "Synced …" at once, yet Sync now still queues
 * (the profile smoke taps it right after seeding and expects a 202).
 */
export const SEEDED_SYNC_AGE_MS = MANUAL_SYNC_THROTTLE_MS + 60_000;

function toBusyBlock(b: SeedBlock): BusyBlock {
  const base = { start: new Date(b.start), end: new Date(b.end) };
  if (b.firstDate && b.lastDate) {
    const allDayDates = { first: b.firstDate, lastInclusive: b.lastDate };
    return { ...base, allDay: true, allDayDates };
  }
  return { ...base, allDay: false };
}

function readAccessSet(access: SeedBusyInput['readAccess']) {
  if (access === 'granted') {
    return { readAccessGranted: true, readEnabled: true, status: 'active' };
  }
  return { readAccessGranted: false, readEnabled: false };
}

function toBlockRow(conn: { id: number; userId: number }, b: BusyBlock) {
  return {
    connectionId: conn.id,
    userId: conn.userId,
    startsAt: b.start,
    endsAt: b.end,
    allDay: b.allDay,
    firstDate: b.allDayDates?.first ?? null,
    lastDate: b.allDayDates?.lastInclusive ?? null,
  };
}

export interface SeedBusyDeps {
  invalidateUser: (userId: number) => void;
  /** `app_settings.default_timezone` (or 'UTC'), read only for `derive`. */
  defaultTimezone: () => Promise<string>;
}

export interface SeedBusyResult {
  inserted: number;
  /** Set iff `derive: true` — the derive's write counts. */
  derived?: CalendarDeriveResult;
}

/** G-2: the PR-B derive for the owner, on its own transaction. */
async function deriveFor(
  db: Db,
  userId: number,
  deps: SeedBusyDeps,
): Promise<CalendarDeriveResult> {
  const defaultTimezone = await deps.defaultTimezone();
  return db.transaction((tx) =>
    runCalendarDerive(tx, userId, { defaultTimezone }),
  );
}

async function findConnection(db: Db, connectionId: number) {
  const conns = schema.calendarConnections;
  const [conn] = await db
    .select({
      id: conns.id,
      userId: conns.userId,
      credentialsEncrypted: conns.credentialsEncrypted,
    })
    .from(conns)
    .where(eq(conns.id, connectionId))
    .limit(1);
  if (!conn) throw new NotFoundException('connection_not_found');
  return conn;
}

/**
 * Insert the blocks for the connection's owner; 404 on an unknown id. The
 * owner's cached game-time is dropped (as the sync processor does) so a
 * test-plan step sees the busy hours (and derived away days) at once.
 */
export async function seedDemoBusy(
  db: Db,
  fake: FakeCalendarProvider,
  input: SeedBusyInput,
  deps: SeedBusyDeps,
): Promise<SeedBusyResult> {
  const conns = schema.calendarConnections;
  const conn = await findConnection(db, input.connectionId);
  const now = Date.now();
  const access = input.readAccess ? readAccessSet(input.readAccess) : {};
  const lastSyncedAt = new Date(now - SEEDED_SYNC_AGE_MS);
  const set = { ...access, lastSyncedAt, updatedAt: new Date(now) };
  await db.update(conns).set(set).where(eq(conns.id, conn.id));
  const blocks = input.blocks.map(toBusyBlock);
  await db
    .insert(schema.calendarBusyBlocks)
    .values(blocks.map((b) => toBlockRow(conn, b)));
  const creds = decryptCalendarCredentials(conn.credentialsEncrypted);
  fake.seedBusyFor(creds, FAKE_PRIMARY_CALENDAR_ID, blocks);
  const derived = input.derive
    ? await deriveFor(db, conn.userId, deps)
    : undefined;
  deps.invalidateUser(conn.userId);
  return derived
    ? { inserted: blocks.length, derived }
    : { inserted: blocks.length };
}
