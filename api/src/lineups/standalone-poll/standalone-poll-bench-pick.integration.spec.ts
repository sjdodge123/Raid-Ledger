/**
 * ROK-2025 — on a scheduling lock, the organizer picks who goes to the bench.
 *
 * The flow is the create form's: POST /events {schedulingMatchId} (signs the
 * creator up, taking one spot), then POST /scheduling-polls/:matchId/complete
 * with `benchUserIds`. The roster is a 2-spot generic one, so with the creator
 * plus three other yes-voters (A, B, C) exactly two of A/B/C overflow.
 *
 * Vote order (D1) = COALESCE(updated_at, created_at), id. The seed makes it
 * creator, A, B, C — and C is the "flipped no→yes last" voter: the EARLIEST
 * created_at but the LATEST updated_at. Votes are inserted in REVERSE, so
 * neither row id nor physical order can pass for vote order.
 *
 *   default bench (no pick)            = { B, C }
 *   created_at-only bench (wrong key)  = { A, B }
 *
 * The auto-signup + DM chain is fire-and-forget after /complete; every
 * roster assertion first waits until every voter's poll DM has landed.
 */
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
  waitFor,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { generatePublicSlug } from '../public-lineup-slug.helpers';

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

const SLOT = new Date('2099-11-12T20:00:00.000Z');
const SLOT_END = new Date('2099-11-12T22:00:00.000Z');
const ROSTER_CAP = 2;
const VOTE_BASE_MS = Date.parse('2026-10-01T12:00:00.000Z');
/** Bound for the fire-and-forget chain (signups + DMs); not a sleep. */
const CHAIN_DEADLINE_MS = 10_000;
const POLL_DM_TITLES = ['On the bench', 'Auto-signed up'];

interface Lock {
  matchId: number;
  lineupId: number;
  eventId: number;
  creator: number;
  a: number;
  b: number;
  c: number;
}

async function createMember(tag: string): Promise<number> {
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({
        discordId: `local:${tag}@test.local`,
        username: tag,
        role: 'member',
      })
      .returning(),
    tag,
  );
  return user.id;
}

/** A standalone poll opened by the admin (the creator). */
async function openStandalonePoll(): Promise<{
  matchId: number;
  lineupId: number;
}> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  return { matchId: res.body.id, lineupId: res.body.lineupId };
}

/** A REGULAR lineup match on `scheduling` (the ROK-2024 open lock-in). */
async function seedLineupMatch(): Promise<{
  matchId: number;
  lineupId: number;
}> {
  const [lineup] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineups)
      .values({
        title: 'Bench pick lineup',
        createdBy: testApp.seed.adminUser.id,
        status: 'decided',
        visibility: 'public',
        publicSlug: generatePublicSlug(),
      })
      .returning(),
    'lineup',
  );
  const [match] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupMatches)
      .values({
        lineupId: lineup.id,
        gameId: testApp.seed.game.id,
        status: 'scheduling',
        thresholdMet: true,
        voteCount: 1,
      })
      .returning(),
    'match',
  );
  await testApp.db.insert(schema.communityLineupMatchMembers).values({
    matchId: match.id,
    userId: testApp.seed.adminUser.id,
    source: 'voted',
  });
  return { matchId: match.id, lineupId: lineup.id };
}

/** Yes votes at SLOT in vote order creator, A, B, C; inserted in reverse. */
async function seedVotes(matchId: number, ids: number[]): Promise<void> {
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  const at = (s: number) => new Date(VOTE_BASE_MS + s * 1000);
  const [creator, a, b, c] = ids;
  const rows = [
    // C: first answered (earliest created_at), said yes LAST (latest flip).
    { userId: c, createdAt: at(-60), updatedAt: at(3) },
    { userId: b, createdAt: at(2), updatedAt: null },
    { userId: a, createdAt: at(1), updatedAt: null },
    { userId: creator, createdAt: at(0), updatedAt: null },
  ];
  for (const row of rows) {
    if (row.userId === undefined) throw new Error('seedVotes needs 4 ids');
    await testApp.db
      .insert(schema.communityLineupScheduleVotes)
      .values({ ...row, userId: row.userId, slotId: slot.id, stance: 'yes' });
  }
}

/** POST /events from the poll on a 2-spot generic roster. */
async function createEventFromPoll(matchId: number): Promise<number> {
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      title: 'Bench pick lock',
      startTime: SLOT.toISOString(),
      endTime: SLOT_END.toISOString(),
      gameId: testApp.seed.game.id,
      slotConfig: { type: 'generic', player: ROSTER_CAP },
      maxAttendees: ROSTER_CAP,
      schedulingMatchId: matchId,
    });
  expect(res.status).toBe(201);
  return res.body.id;
}

/** Seed the poll + votes + event; nothing is completed yet. */
async function seedLock(kind: 'standalone' | 'lineup'): Promise<Lock> {
  const poll =
    kind === 'standalone'
      ? await openStandalonePoll()
      : await seedLineupMatch();
  const creator = testApp.seed.adminUser.id;
  const a = await createMember(`bench-a-${kind}`);
  const b = await createMember(`bench-b-${kind}`);
  const c = await createMember(`bench-c-${kind}`);
  await seedVotes(poll.matchId, [creator, a, b, c]);
  const eventId = await createEventFromPoll(poll.matchId);
  return { ...poll, eventId, creator, a, b, c };
}

function complete(matchId: number, body: Record<string, unknown>) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/complete`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

/** Complete the lock with `benchUserIds` (omitted when undefined). */
async function lockIn(lock: Lock, benchUserIds?: number[]): Promise<void> {
  const res = await complete(lock.matchId, {
    eventId: lock.eventId,
    startTime: SLOT.toISOString(),
    ...(benchUserIds ? { benchUserIds } : {}),
  });
  expect({ status: res.status, body: res.body }).toEqual({
    status: 200,
    body: { ok: true },
  });
}

async function matchStatus(matchId: number): Promise<string | undefined> {
  const [row] = await testApp.db
    .select({ status: schema.communityLineupMatches.status })
    .from(schema.communityLineupMatches)
    .where(eq(schema.communityLineupMatches.id, matchId));
  return row?.status;
}

async function signedUpUserIds(eventId: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.eventId, eventId));
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId])).sort();
}

async function benchedUserIds(eventId: number): Promise<number[]> {
  const rows = await testApp.db
    .select({ userId: schema.eventSignups.userId })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'bench'),
      ),
    );
  return rows.flatMap((r) => (r.userId === null ? [] : [r.userId])).sort();
}

/** The poll DM title each of `userIds` got, once every one has landed. */
async function pollDmTitles(
  userIds: number[],
): Promise<Array<{ userId: number; titles: string[] }>> {
  let result: Array<{ userId: number; titles: string[] }> = [];
  await waitFor(async () => {
    const rows = await testApp.db
      .select({
        userId: schema.notifications.userId,
        title: schema.notifications.title,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.type, 'community_lineup'));
    result = userIds.map((userId) => ({
      userId,
      titles: rows
        .filter((r) => r.userId === userId && POLL_DM_TITLES.includes(r.title))
        .map((r) => r.title),
    }));
    expect(result.filter((r) => r.titles.length === 0)).toEqual([]);
  }, CHAIN_DEADLINE_MS);
  return result;
}

/** Bench = exactly `bench`; DMs: "On the bench" to them, else "Auto-signed up". */
async function expectBenchOutcome(lock: Lock, bench: number[]): Promise<void> {
  const voters = [lock.creator, lock.a, lock.b, lock.c];
  const dms = await pollDmTitles(voters);
  expect(await benchedUserIds(lock.eventId)).toEqual([...bench].sort());
  expect(dms).toEqual(
    voters.map((userId) => ({
      userId,
      titles: [bench.includes(userId) ? 'On the bench' : 'Auto-signed up'],
    })),
  );
  expect(await signedUpUserIds(lock.eventId)).toEqual([...voters].sort());
}

describe('ROK-2025 (a) standalone lock — the organizer pick is benched', () => {
  it('benches exactly the picked A and B (not the default B, C)', async () => {
    const lock = await seedLock('standalone');
    await lockIn(lock, [lock.a, lock.b]);
    await expectBenchOutcome(lock, [lock.a, lock.b]);
  });
});

describe('ROK-2025 (b) open lineup lock (ROK-2024 path) — the pick is benched', () => {
  it('benches exactly the picked A and C on a regular lineup match', async () => {
    const lock = await seedLock('lineup');
    await lockIn(lock, [lock.a, lock.c]);
    await expectBenchOutcome(lock, [lock.a, lock.c]);
  });
});

describe('ROK-2025 (c) no pick — the latest yes-voters are benched', () => {
  it('benches B and C, where C flipped no→yes last (COALESCE order)', async () => {
    const lock = await seedLock('standalone');
    await lockIn(lock);
    await expectBenchOutcome(lock, [lock.b, lock.c]);
  });
});

describe('ROK-2025 (d) a refused pick is a 400 that leaves the poll open', () => {
  const NOT_A_VOTER =
    'Only people who voted yes for this time can go to the bench.';
  const WRONG_COUNT =
    'The votes changed while you were choosing. Pick exactly 2 for the bench.';
  const cases: Array<
    [string, (l: Lock, outsider: number) => number[], string]
  > = [
    ['a non-voter', (l, outsider) => [l.a, outsider], NOT_A_VOTER],
    ['the creator', (l) => [l.a, l.creator], NOT_A_VOTER],
    [
      'a duplicate',
      (l) => [l.a, l.a],
      'Each person can only be picked for the bench once.',
    ],
    ['one too few', (l) => [l.a], WRONG_COUNT],
    ['one too many', (l) => [l.a, l.b, l.c], WRONG_COUNT],
  ];

  it.each(cases)(
    'refuses %s with the exact copy',
    async (_label, pick, copy) => {
      const lock = await seedLock('standalone');
      const outsider = await createMember('bench-outsider');
      const res = await complete(lock.matchId, {
        eventId: lock.eventId,
        startTime: SLOT.toISOString(),
        benchUserIds: pick(lock, outsider),
      });
      expect({ status: res.status, message: res.body.message }).toEqual({
        status: 400,
        message: copy,
      });
      expect(await matchStatus(lock.matchId)).toBe('scheduling');
      // Nothing ran: only the creator (signed up by POST /events) is on it.
      expect(await signedUpUserIds(lock.eventId)).toEqual([lock.creator]);
    },
  );

  it('refuses benchUserIds without eventId (contract refine)', async () => {
    const lock = await seedLock('standalone');
    const res = await complete(lock.matchId, { benchUserIds: [lock.a] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('benchUserIds needs eventId');
    expect(await matchStatus(lock.matchId)).toBe('scheduling');
  });

  it('after a refusal, a retry without picks completes (D6)', async () => {
    const lock = await seedLock('standalone');
    const refused = await complete(lock.matchId, {
      eventId: lock.eventId,
      startTime: SLOT.toISOString(),
      benchUserIds: [lock.a],
    });
    expect(refused.status).toBe(400);
    await lockIn(lock);
    await expectBenchOutcome(lock, [lock.b, lock.c]);
  });
});

describe('ROK-2025 (e) the poll page lists slot votes in vote order', () => {
  it('returns votes as creator, A, B, C — C last for its late flip', async () => {
    const lock = await seedLock('standalone');
    const res = await testApp.request
      .get(`/lineups/${lock.lineupId}/schedule/${lock.matchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const slots: Array<{
      proposedTime: string;
      votes: Array<{ userId: number }>;
    }> = res.body.slots;
    const slot = slots.find(
      (s) => Date.parse(s.proposedTime) === SLOT.getTime(),
    );
    expect(slot?.votes.map((v) => v.userId)).toEqual([
      lock.creator,
      lock.a,
      lock.b,
      lock.c,
    ]);
  });
});
