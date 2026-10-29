/**
 * ROK-2041 — GET /events/:id/detail `myConflicts` counted an event the viewer
 * had LEFT. Leaving within 23h of start writes `roached_out` (not `declined`),
 * and the conflict finder only excluded declined/departed. The status filter is
 * SQL-side, so only a real database proves which statuses count.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import type { SignupStatus } from '../drizzle/schema/event-signups';

const HOUR = 3_600_000;

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

async function createEvent(title: string, startOffsetMs: number) {
  const start = Date.now() + startOffsetMs;
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title,
        creatorId: testApp.seed.adminUser.id,
        duration: [new Date(start), new Date(start + 2 * HOUR)],
      })
      .returning(),
    'event',
  );
  return event.id;
}

/** Event A (signed up with `status`) overlaps event B; returns B's conflicts. */
async function conflictsSeenFromB(status: SignupStatus) {
  const eventA = await createEvent('Gamernight', 3 * HOUR);
  const eventB = await createEvent('BG3', 3 * HOUR + 30 * 60_000);
  await testApp.db.insert(schema.eventSignups).values({
    eventId: eventA,
    userId: testApp.seed.adminUser.id,
    status,
  });
  const res = await testApp.request
    .get(`/events/${eventB}/detail`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(200);
  const conflicts = res.body.event.myConflicts as { id: number }[];
  return { eventA, ids: conflicts.map((c) => c.id) };
}

describe('event conflicts count only active signups (ROK-2041)', () => {
  it('an event left within 23h (roached_out) is not a conflict', async () => {
    const { ids } = await conflictsSeenFromB('roached_out');
    expect(ids).toEqual([]);
  });

  it.each<SignupStatus>(['declined', 'departed'])(
    'a %s signup is not a conflict',
    async (status) => {
      const { ids } = await conflictsSeenFromB(status);
      expect(ids).toEqual([]);
    },
  );

  it.each<SignupStatus>(['signed_up', 'tentative'])(
    'a %s signup is still a conflict',
    async (status) => {
      const { eventA, ids } = await conflictsSeenFromB(status);
      expect(ids).toEqual([eventA]);
    },
  );
});
