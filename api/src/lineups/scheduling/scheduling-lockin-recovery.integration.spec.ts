/**
 * ROK-2033 — recover a poll left locked-in with no event after a crash.
 *
 * Proves the spec §4.2 table against a real DB: a stamped, never-linked claim
 * (crash orphan) is recoverable, while a locked-in event deleted on purpose,
 * a pre-migration row, a reschedule poll and a finished lock-in are never
 * selected; link and release are fenced on the claim's own token.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { nonEmpty } from '../../common/testing/narrow';
import { EventsService } from '../../events/events.service';
import {
  claimMatchForLockIn,
  linkClaimedMatch,
  releaseMatchClaim,
} from './scheduling-lockin-claim.helpers';
import {
  findRecoverableClaim,
  findStaleClaims,
  recoverClaim,
  type LockInRecoveryDeps,
  type PendingLockInClaim,
} from './scheduling-lockin-recovery.helpers';

let testApp: TestApp;
let adminToken: string;

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

const SLOT = new Date('2099-11-12T20:00:00.000Z');
const SLOT_END = new Date('2099-11-12T22:00:00.000Z');
const MINUTE = 60_000;
const m = schema.communityLineupMatches;

function eventDto() {
  return {
    title: 'Lock-in recovery',
    startTime: SLOT.toISOString(),
    endTime: SLOT_END.toISOString(),
    gameId: testApp.seed.game.id,
    slotConfig: { type: 'generic' as const, player: 5 },
    maxAttendees: 5,
  };
}

/** A standalone poll on `scheduling` with the admin's yes vote on SLOT. */
async function openPoll(): Promise<number> {
  const res = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(res.status).toBe(201);
  const matchId: number = res.body.id;
  const [slot] = nonEmpty(
    await testApp.db
      .insert(schema.communityLineupScheduleSlots)
      .values({ matchId, proposedTime: SLOT, suggestedBy: 'user' })
      .returning(),
    'slot',
  );
  await testApp.db.insert(schema.communityLineupScheduleVotes).values({
    userId: testApp.seed.adminUser.id,
    slotId: slot.id,
    stance: 'yes',
  });
  return matchId;
}

function lockInRoute(matchId: number) {
  return testApp.request
    .post(`/scheduling-polls/${matchId}/lock-in`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ event: eventDto(), startTime: SLOT.toISOString() });
}

async function createEvent(matchId: number): Promise<number> {
  const events = testApp.app.get(EventsService);
  const ev = await events.create(testApp.seed.adminUser.id, {
    ...eventDto(),
    schedulingMatchId: matchId,
  });
  return ev.id;
}

async function matchRow(matchId: number) {
  const [row] = await testApp.db
    .select({
      status: m.status,
      linkedEventId: m.linkedEventId,
      lockInClaimedAt: m.lockInClaimedAt,
    })
    .from(m)
    .where(eq(m.id, matchId));
  return row;
}

/** Simulate a crash: claim, then age the stamp so the sweep would pick it. */
async function crashedClaim(matchId: number): Promise<PendingLockInClaim> {
  await claimMatchForLockIn(testApp.db, matchId);
  const claimedAt = new Date(Date.now() - 11 * MINUTE);
  await testApp.db
    .update(m)
    .set({ lockInClaimedAt: claimedAt })
    .where(eq(m.id, matchId));
  return { matchId, claimedAt };
}

async function setCreatedAt(eventId: number, at: Date): Promise<void> {
  await testApp.db
    .update(schema.events)
    .set({ createdAt: at })
    .where(eq(schema.events.id, eventId));
}

function deps(): LockInRecoveryDeps & {
  pollEmbed: { fireUpdateEmbed: jest.Mock };
} {
  return {
    db: testApp.db,
    eventsService: testApp.app.get(EventsService),
    pollEmbed: { fireUpdateEmbed: jest.fn() },
    logger: { warn: jest.fn(), error: jest.fn() },
  };
}

const staleIds = async (now = new Date()) =>
  (await findStaleClaims(testApp.db, now)).map((c) => c.matchId);

describe('lock-in claim recovery (ROK-2033)', () => {
  it('row 1: a crash before the create is swept back to scheduling and can lock in again', async () => {
    const matchId = await openPoll();
    const claim = await crashedClaim(matchId);
    expect(await staleIds()).toEqual([matchId]);
    const d = deps();
    const result = await recoverClaim(d, claim, { kind: 'cron' });
    expect(result).toEqual({ recovered: true, discardedEventIds: [] });
    expect(await matchRow(matchId)).toMatchObject({
      status: 'scheduling',
      linkedEventId: null,
      lockInClaimedAt: null,
    });
    expect(d.pollEmbed.fireUpdateEmbed).toHaveBeenCalledWith(matchId);
    const res = await lockInRoute(matchId);
    expect(res.status).toBe(200);
    const row = await matchRow(matchId);
    expect(row?.linkedEventId).toBe(res.body.event.id);
    expect(row?.lockInClaimedAt).toBeNull();
  });

  it('row 2: a crash after the create deletes only the claim’s own events', async () => {
    const matchId = await openPoll();
    const older = await createEvent(matchId);
    const orphan = await createEvent(matchId);
    const claim = await crashedClaim(matchId);
    await setCreatedAt(older, new Date(claim.claimedAt.getTime() - MINUTE));
    await setCreatedAt(orphan, new Date(claim.claimedAt.getTime() + 1000));
    const result = await recoverClaim(deps(), claim, {
      kind: 'admin',
      userId: testApp.seed.adminUser.id,
    });
    expect(result).toEqual({ recovered: true, discardedEventIds: [orphan] });
    const left = await testApp.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.createdFromPollId, matchId));
    expect(left.map((r) => r.id)).toEqual([older]);
  });

  it('row 3: a locked-in event deleted on purpose is never reopened', async () => {
    const matchId = await openPoll();
    const res = await lockInRoute(matchId);
    expect(res.status).toBe(200);
    await testApp.app
      .get(EventsService)
      .delete(res.body.event.id, testApp.seed.adminUser.id, true);
    expect(await matchRow(matchId)).toEqual({
      status: 'scheduled',
      linkedEventId: null,
      lockInClaimedAt: null,
    });
    expect(await staleIds(new Date(Date.now() + 24 * 60 * MINUTE))).toEqual([]);
    expect(await findRecoverableClaim(testApp.db, matchId)).toBeNull();
  });

  it('row 4: a pre-migration scheduled+unlinked row (stamp NULL) is never selected', async () => {
    const matchId = await openPoll();
    await testApp.db
      .update(m)
      .set({ status: 'scheduled' })
      .where(eq(m.id, matchId));
    expect(await staleIds(new Date(Date.now() + 24 * 60 * MINUTE))).toEqual([]);
    expect(await findRecoverableClaim(testApp.db, matchId)).toBeNull();
  });

  it('row 5: a young claim is left to the in-flight request by the sweep, but the admin may recover it', async () => {
    const matchId = await openPoll();
    const claim = await claimMatchForLockIn(testApp.db, matchId);
    expect(await staleIds()).toEqual([]);
    const pending = await findRecoverableClaim(testApp.db, matchId);
    expect(pending?.claimedAt.getTime()).toBe(claim.claimedAt?.getTime());
  });

  it('rows 6/7: a recovered claim fences off the stale request’s link and release', async () => {
    const matchId = await openPoll();
    const first = await claimMatchForLockIn(testApp.db, matchId);
    const pending = must(
      await findRecoverableClaim(testApp.db, matchId),
      'pending claim',
    );
    expect(
      (await recoverClaim(deps(), pending, { kind: 'cron' })).recovered,
    ).toBe(true);
    const second = await claimMatchForLockIn(testApp.db, matchId);
    const eventId = await createEventUnchecked();
    const lateLink = await linkClaimedMatch(
      testApp.db,
      matchId,
      eventId,
      first.claimedAt,
    );
    expect(lateLink).toBe(false);
    await releaseMatchClaim(testApp.db, matchId, first, { error: jest.fn() });
    const row = await matchRow(matchId);
    expect(row?.status).toBe('scheduled');
    expect(row?.linkedEventId).toBeNull();
    expect(row?.lockInClaimedAt?.getTime()).toBe(second.claimedAt?.getTime());
  });

  it('row 6: recovery after the in-flight link landed touches nothing', async () => {
    const matchId = await openPoll();
    const eventId = await createEvent(matchId);
    const claim = await claimMatchForLockIn(testApp.db, matchId);
    const claimedAt = must(claim.claimedAt, 'claimedAt');
    expect(
      await linkClaimedMatch(testApp.db, matchId, eventId, claimedAt),
    ).toBe(true);
    const d = deps();
    const result = await recoverClaim(
      d,
      { matchId, claimedAt },
      {
        kind: 'cron',
      },
    );
    expect(result).toEqual({ recovered: false, discardedEventIds: [] });
    expect(await matchRow(matchId)).toEqual({
      status: 'scheduled',
      linkedEventId: eventId,
      lockInClaimedAt: null,
    });
    expect(d.pollEmbed.fireUpdateEmbed).not.toHaveBeenCalled();
  });

  it('row 8: a reschedule claim (poll already linked) is not stamped and never selected', async () => {
    const matchId = await openPoll();
    const eventId = await createEvent(matchId);
    await testApp.db
      .update(m)
      .set({ linkedEventId: eventId })
      .where(eq(m.id, matchId));
    const claim = await claimMatchForLockIn(
      testApp.db,
      matchId,
      ['scheduling'],
      eventId,
    );
    expect(claim.claimedAt).toBeNull();
    expect((await matchRow(matchId))?.lockInClaimedAt).toBeNull();
    expect(await staleIds(new Date(Date.now() + 24 * 60 * MINUTE))).toEqual([]);
  });
});

/** An event with no poll provenance (the claim holds the poll). */
async function createEventUnchecked(): Promise<number> {
  const ev = await testApp.app
    .get(EventsService)
    .create(testApp.seed.adminUser.id, eventDto());
  return ev.id;
}

function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined)
    throw new Error(`missing ${label}`);
  return value;
}
