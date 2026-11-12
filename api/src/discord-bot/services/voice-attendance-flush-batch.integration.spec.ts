/**
 * ROK-2174: the 30 s voice-attendance flush writes one multi-row upsert per
 * tick. Against a real DB it must write exactly what the old per-row path
 * wrote (insert AND conflict-update rows in the same tick), write nothing on
 * an empty tick, and fall back per row so one bad row cannot lose the rest.
 */
import { asc, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { nonEmpty } from '../../common/testing/narrow';
import * as schema from '../../drizzle/schema';
import {
  flushDirtySessions,
  flushSingleSession,
} from './voice-attendance-flush-write.helpers';
import type { InMemorySession } from './voice-attendance.helpers';

const MIN = 60_000;
const START = new Date(Math.floor((Date.now() - 30 * MIN) / MIN) * MIN);
const END = new Date(START.getTime() + 120 * MIN);

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
});

function makeLogger() {
  return { error: jest.fn(), debug: jest.fn(), warn: jest.fn() };
}

async function seedEvent(title: string): Promise<number> {
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title,
        creatorId: testApp.seed.adminUser.id,
        duration: [START, END],
      })
      .returning({ id: schema.events.id }),
    'event',
  );
  return event.id;
}

/** A closed (left) session, fully deterministic — no active-segment clock. */
function session(
  eventId: number,
  n: number,
  userId: number | null,
): InMemorySession {
  const join = new Date(START.getTime() + n * MIN);
  const leave = new Date(join.getTime() + 10 * MIN);
  return {
    eventId,
    userId,
    discordUserId: `discord-${n}`,
    discordUsername: `User${n}-renamed`,
    discordAvatarHash: null,
    firstJoinAt: join,
    lastLeaveAt: leave,
    totalDurationSec: 600,
    segments: [
      {
        joinAt: join.toISOString(),
        leaveAt: leave.toISOString(),
        durationSec: 600,
      },
    ],
    isActive: false,
    activeSegmentStart: null,
    dirty: true,
  };
}

/** Pre-existing row for discord-1 so the tick hits the conflict path. */
async function seedExistingRow(eventId: number): Promise<void> {
  await testApp.db.insert(schema.eventVoiceSessions).values({
    eventId,
    userId: null,
    discordUserId: 'discord-1',
    discordUsername: 'User1-old',
    firstJoinAt: new Date(START.getTime() - 5 * MIN),
    lastLeaveAt: null,
    totalDurationSec: 30,
    segments: [],
    classification: 'partial',
  });
}

/** Rows for an event, stripped of the per-row uuid and event id. */
async function rowsFor(eventId: number) {
  const t = schema.eventVoiceSessions;
  return testApp.db
    .select({
      userId: t.userId,
      discordUserId: t.discordUserId,
      discordUsername: t.discordUsername,
      firstJoinAt: t.firstJoinAt,
      lastLeaveAt: t.lastLeaveAt,
      totalDurationSec: t.totalDurationSec,
      segments: t.segments,
      classification: t.classification,
    })
    .from(t)
    .where(eq(t.eventId, eventId))
    .orderBy(asc(t.discordUserId));
}

function tick(eventId: number): Map<string, InMemorySession> {
  const admin = testApp.seed.adminUser.id;
  const list = [session(eventId, 1, admin), session(eventId, 2, null)];
  list.push(session(eventId, 3, admin));
  return new Map(list.map((s) => [`${s.eventId}:${s.discordUserId}`, s]));
}

describe('voice-attendance batched flush (ROK-2174)', () => {
  it('writes the same rows as the per-row path for a mixed insert + update tick', async () => {
    const batchEvent = await seedEvent('ROK-2174 batch');
    const rowEvent = await seedEvent('ROK-2174 per-row');
    await seedExistingRow(batchEvent);
    await seedExistingRow(rowEvent);

    const batchTick = tick(batchEvent);
    await flushDirtySessions(testApp.db, batchTick, makeLogger());
    for (const s of tick(rowEvent).values()) {
      await flushSingleSession(testApp.db, s, makeLogger());
    }

    const batchRows = await rowsFor(batchEvent);
    expect(batchRows).toHaveLength(3);
    expect(batchRows).toEqual(await rowsFor(rowEvent));
    // Conflict row: set columns overwritten, first_join_at + classification kept.
    expect(batchRows[0]).toMatchObject({
      discordUserId: 'discord-1',
      discordUsername: 'User1-renamed',
      userId: testApp.seed.adminUser.id,
      totalDurationSec: 600,
      firstJoinAt: new Date(START.getTime() - 5 * MIN),
      classification: 'partial',
    });
    expect([...batchTick.values()].every((s) => !s.dirty)).toBe(true);
  });

  it('writes nothing when no session is dirty or active', async () => {
    const eventId = await seedEvent('ROK-2174 empty');
    const clean = tick(eventId);
    for (const s of clean.values()) s.dirty = false;

    await flushDirtySessions(testApp.db, clean, makeLogger());

    expect(await rowsFor(eventId)).toEqual([]);
  });

  it('falls back per row when the batch fails, so the good rows still land', async () => {
    const eventId = await seedEvent('ROK-2174 fallback');
    const sessions = tick(eventId);
    // A session for an event that does not exist: its FK violation fails the
    // whole batch statement, and only that row in the per-row retry.
    const orphan = session(eventId + 10_000, 9, null);
    sessions.set(`${orphan.eventId}:${orphan.discordUserId}`, orphan);
    const logger = makeLogger();

    await flushDirtySessions(testApp.db, sessions, logger);

    const rows = await rowsFor(eventId);
    expect(rows.map((r) => r.discordUserId)).toEqual([
      'discord-1',
      'discord-2',
      'discord-3',
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(orphan.dirty).toBe(true);
  });
});
