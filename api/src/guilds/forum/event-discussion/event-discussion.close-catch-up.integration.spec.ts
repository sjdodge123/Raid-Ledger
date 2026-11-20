/**
 * ROK-2272 S0a — the boot catch-up re-derives `write_closes_at` for live
 * event threads still carrying the old end + 24 h deadline (stale = later
 * than end + 1 h), and leaves detached, already-closed and up-to-date threads
 * alone. A second run is a no-op. The boot hook itself is skipped here
 * (CRON_DISABLED), so only these explicit calls run it. Every test builds its own hub
 * and event; no shared truncation.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../../common/testing/test-app';
import { nonEmpty } from '../../../common/testing/narrow';
import * as schema from '../../../drizzle/schema';
import { closeCatchUp } from './event-discussion.close-catch-up';
import { syncEventDiscussion } from './event-discussion.sync';

const HOUR = 3_600_000;
const threads = schema.hubForumThreads;
let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

async function newHub(): Promise<number> {
  seq += 1;
  const name = `Close Catch-up ${seq} ${Date.now()}`;
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: testApp.seed.game.id,
        region: 'us',
        name,
        nameKey: name.toLowerCase(),
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

/** A hub-tagged event ending `endInMs` from now, with its live thread. */
async function scene(endInMs: number) {
  const guildId = await newHub();
  const end = new Date(Math.floor((Date.now() + endInMs) / 1000) * 1000);
  const [e] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: 'Molten Core',
        creatorId: testApp.seed.adminUser.id,
        gameId: testApp.seed.game.id,
        guildId,
        duration: [new Date(end.getTime() - 2 * HOUR), end] as [Date, Date],
      })
      .returning(),
    'event',
  );
  expect(await syncEventDiscussion(testApp.db, e.id)).toBe('insert');
  return { eventId: e.id, end };
}

async function setThread(
  eventId: number,
  patch: Partial<typeof threads.$inferInsert>,
) {
  const rows = await testApp.db
    .update(threads)
    .set(patch)
    .where(eq(threads.eventId, eventId))
    .returning({ id: threads.id });
  expect(rows).toHaveLength(1);
}

async function closesAt(eventId: number): Promise<number | undefined> {
  const [row] = nonEmpty(
    await testApp.db
      .select({ at: threads.writeClosesAt })
      .from(threads)
      .where(eq(threads.eventId, eventId)),
    'thread',
  );
  return row.at?.getTime();
}

describe('ROK-2272 S0a — closeCatchUp', () => {
  it('rewrites a live thread stored at end + 24 h to end + 1 h', async () => {
    const { eventId, end } = await scene(2 * HOUR);
    await setThread(eventId, {
      writeClosesAt: new Date(end.getTime() + 24 * HOUR),
    });
    expect(await closesAt(eventId)).toBe(end.getTime() + 24 * HOUR);
    expect(await closeCatchUp(testApp.db, new Date())).toBeGreaterThanOrEqual(
      1,
    );
    expect(await closesAt(eventId)).toBe(end.getTime() + HOUR);
  });

  it('an event that ended 3 h ago but stored end + 24 h is pulled into the past', async () => {
    const { eventId, end } = await scene(-3 * HOUR);
    await setThread(eventId, {
      writeClosesAt: new Date(end.getTime() + 24 * HOUR),
    });
    await closeCatchUp(testApp.db, new Date());
    expect(await closesAt(eventId)).toBe(end.getTime() + HOUR);
  });

  it('leaves a detached thread untouched', async () => {
    const { eventId, end } = await scene(2 * HOUR);
    const stale = end.getTime() + 24 * HOUR;
    await setThread(eventId, {
      writeClosesAt: new Date(stale),
      eventDetachedAt: new Date(),
    });
    await closeCatchUp(testApp.db, new Date());
    expect(await closesAt(eventId)).toBe(stale);
    const live = await testApp.db
      .select({ id: threads.id })
      .from(threads)
      .where(
        and(eq(threads.eventId, eventId), isNull(threads.eventDetachedAt)),
      );
    expect(live).toHaveLength(0);
  });

  it('leaves a thread whose stored deadline has already passed untouched', async () => {
    const { eventId, end } = await scene(-3 * HOUR);
    const past = end.getTime() + 30 * 60_000;
    await setThread(eventId, { writeClosesAt: new Date(past) });
    await closeCatchUp(testApp.db, new Date());
    expect(await closesAt(eventId)).toBe(past);
  });
});

describe('ROK-2272 S0a — closeCatchUp selects stale rows only', () => {
  it('a second run is a no-op: nothing stale is left after the first', async () => {
    const { eventId, end } = await scene(5 * HOUR);
    await setThread(eventId, {
      writeClosesAt: new Date(end.getTime() + 24 * HOUR),
    });
    expect(await closeCatchUp(testApp.db, new Date())).toBeGreaterThanOrEqual(
      1,
    );
    expect(await closesAt(eventId)).toBe(end.getTime() + HOUR);
    expect(await closeCatchUp(testApp.db, new Date())).toBe(0);
  });

  it('an upcoming event with a correct end + 1 h deadline is not selected', async () => {
    const { eventId, end } = await scene(6 * HOUR);
    expect(await closesAt(eventId)).toBe(end.getTime() + HOUR);
    expect(await closeCatchUp(testApp.db, new Date())).toBe(0);
    expect(await closesAt(eventId)).toBe(end.getTime() + HOUR);
  });

  it('an upcoming thread whose deadline is not later than end + 1 h is left alone', async () => {
    const { eventId, end } = await scene(4 * HOUR);
    const early = end.getTime() + 30 * 60_000;
    await setThread(eventId, { writeClosesAt: new Date(early) });
    await closeCatchUp(testApp.db, new Date());
    expect(await closesAt(eventId)).toBe(early);
  });
});
