/**
 * ROK-1593 §3.6: `POST /admin/test/calendar/seed-busy` — DEMO_MODE only.
 *
 * Writes foreign busy blocks for one connection straight into
 * `calendar_busy_blocks` (no queue, deterministic for the fleet plan and
 * ROK-1595's Playwright) AND into the Fake's `primary` calendar, so a later
 * sync of a `demo-fake:` row (cron, kill switch back on, `POST …/sync`) reads
 * the same blocks instead of erasing them. `readAccess` optionally flips the
 * row's read grant: `granted` → read on, `active`; `missing` → read off.
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { FAKE_PRIMARY_CALENDAR_ID } from '../providers/testing/fake-calendar-store';
import type { FakeCalendarProvider } from '../providers/testing/fake-calendar.provider';
import type { BusyBlock } from '../providers/calendar-provider.interface';

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
  })
  .strict();
export type SeedBusyInput = z.infer<typeof SeedBusySchema>;

type SeedBlock = SeedBusyInput['blocks'][number];

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

/** Insert the blocks for the connection's owner; 404 on an unknown id. */
export async function seedDemoBusy(
  db: Db,
  fake: FakeCalendarProvider,
  input: SeedBusyInput,
): Promise<{ inserted: number }> {
  const conns = schema.calendarConnections;
  const [conn] = await db
    .select({ id: conns.id, userId: conns.userId })
    .from(conns)
    .where(eq(conns.id, input.connectionId))
    .limit(1);
  if (!conn) throw new NotFoundException('connection_not_found');
  if (input.readAccess) {
    const set = { ...readAccessSet(input.readAccess), updatedAt: new Date() };
    await db.update(conns).set(set).where(eq(conns.id, conn.id));
  }
  const blocks = input.blocks.map(toBusyBlock);
  await db
    .insert(schema.calendarBusyBlocks)
    .values(blocks.map((b) => toBlockRow(conn, b)));
  fake.seedBusy(FAKE_PRIMARY_CALENDAR_ID, blocks);
  return { inserted: blocks.length };
}
