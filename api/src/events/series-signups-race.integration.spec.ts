/**
 * ROK-1728 Codex P2 — a leave that lands while a join is still filling its
 * nights. Join and leave run on separate pooled connections (SignupsService
 * is not tx-aware), so the race is made deterministic with a seam: the first
 * `SignupsService.signup` call of the join runs the whole leave first.
 * Series: nights 2 and 3 days away, no prior signups, so both are `create`.
 */
import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { SeriesSignupsService } from './series-signups.service';
import { SignupsService } from './signups.service';

const HOUR = 60 * 60 * 1000;
const ACTIVE = ['signed_up', 'tentative'];

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

// No afterAll truncate: the shared app's pool must stay open.
afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function insertNight(groupId: string, offsetHours: number) {
  const start = new Date(Date.now() + offsetHours * HOUR);
  const end = new Date(start.getTime() + 3 * HOUR);
  const [event] = nonEmpty(
    await testApp.db
      .insert(schema.events)
      .values({
        title: `Race night ${offsetHours}h`,
        creatorId: testApp.seed.adminUser.id,
        duration: [start, end] as [Date, Date],
        recurrenceGroupId: groupId,
      })
      .returning(),
    'race night',
  );
  return event.id;
}

async function createMember(): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: '172899000000000001',
        username: 'series_race_member',
        role: 'member',
      })
      .returning(),
    'member',
  );
  return user.id;
}

const es = schema.eventSignups;

describe('leave during a join (Codex P2: join/leave race)', () => {
  it('a leave between plan and fill leaves no night active or tagged to the ended membership, and the join is 409', async () => {
    const groupId = randomUUID();
    const n2 = await insertNight(groupId, 48);
    const n3 = await insertNight(groupId, 96);
    const userId = await createMember();
    const series = testApp.app.get(SeriesSignupsService);
    const svc = testApp.app.get(SignupsService);
    const real = svc.signup.bind(svc);
    // Membership is inserted, nothing is tagged yet: the leave finds no
    // tagged night to cancel, ends the membership, then the join resumes.
    jest.spyOn(svc, 'signup').mockImplementationOnce(async (...args) => {
      await series.leave(n2, userId);
      return real(...args);
    });

    const outcome: unknown = await series.join(n2, userId, {}).then(
      () => 'resolved',
      (err: unknown) => err,
    );

    const [membership] = await testApp.db
      .select()
      .from(schema.seriesSignups)
      .where(eq(schema.seriesSignups.userId, userId));
    expect(membership?.status).toBe('left');
    const membershipId = membership?.id ?? -1;
    // mutation: drop the post-fill membership re-check in join()
    const tagged = await testApp.db
      .select({ eventId: es.eventId, status: es.status })
      .from(es)
      .where(eq(es.seriesSignupId, membershipId));
    expect(tagged).toEqual([]);
    const active = await testApp.db
      .select({ eventId: es.eventId })
      .from(es)
      .where(
        and(
          eq(es.userId, userId),
          inArray(es.eventId, [n2, n3]),
          inArray(es.status, ACTIVE),
        ),
      );
    expect(active).toEqual([]);
    expect(outcome).toMatchObject({
      status: 409,
      message: 'You left the series while this join was running',
    });
  });
});
