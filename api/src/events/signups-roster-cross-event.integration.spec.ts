/**
 * ROK-2321 — a roster_assignments row must never reach across events.
 *
 * 1. PATCH /events/A/roster with a signupId from event B is a 400 and leaves
 *    B's signup and B's roster row exactly as they were.
 * 2. Signup-keyed readers are scoped to their event: a row event A holds for
 *    B's signup (the shape the PATCH could write before ROK-2141) is not
 *    treated as B's assignment when the B signup is cancelled.
 * 3. The same holds for every other signup-keyed path: self-unassign, the
 *    anonymous Discord cancel, the departure-grace bench move and rejoin
 *    reassignment, the demo cancel helper and the follow-up carryover read.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { eq } from 'drizzle-orm';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import {
  createMemberAndLogin,
  createMmoEvent,
  signupViaDb,
} from './signups.integration.spec-helpers';
import { SignupsService } from './signups.service';
import { BenchPromotionService } from './bench-promotion.service';
import { cancelSignup } from './signup-cancel.helpers';
import { moveToBench } from '../discord-bot/processors/departure-grace.helpers';
import { DepartureGraceService } from '../discord-bot/services/departure-grace.service';
import { loadFollowupCarryover } from '../lineups/standalone-poll/followup-signup-carryover.helpers';

let testApp: TestApp;
let adminToken: string;

function rosterRowsOf(eventId: number) {
  return testApp.db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.eventId, eventId));
}

async function signupRow(signupId: number) {
  const [row] = await testApp.db
    .select()
    .from(schema.eventSignups)
    .where(eq(schema.eventSignups.id, signupId));
  return row;
}

async function placeRow(eventId: number, signupId: number, role: string) {
  await testApp.db
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role, position: 1 });
}

/** Event A (creator: admin) and a victim signed up — and slotted — on event B. */
async function seedTwoEvents() {
  const eventA = await createMmoEvent(testApp, adminToken);
  const eventB = await createMmoEvent(testApp, adminToken);
  const victim = await createMemberAndLogin(
    testApp,
    'crossvictim',
    'crossvictim@test.local',
  );
  const victimSignupB = await signupViaDb(testApp, eventB, victim.userId);
  return { eventA, eventB, victim, victimSignupB };
}

async function testPatchWithForeignSignupIdRejected() {
  const { eventA, eventB, victim, victimSignupB } = await seedTwoEvents();
  await placeRow(eventB, victimSignupB.id, 'tank');
  const before = await signupRow(victimSignupB.id);
  const res = await testApp.request
    .patch(`/events/${eventA}/roster`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      assignments: [
        {
          userId: victim.userId,
          signupId: victimSignupB.id,
          slot: 'dps',
          position: 2,
        },
      ],
    });
  expect(res.status).toBe(400);
  expect(String(res.body.message)).toContain(
    `Signup ${victimSignupB.id} is not part of this event`,
  );
  expect(await rosterRowsOf(eventA)).toEqual([]);
  expect(await rosterRowsOf(eventB)).toEqual([
    expect.objectContaining({
      signupId: victimSignupB.id,
      role: 'tank',
      position: 1,
    }),
  ]);
  expect(await signupRow(victimSignupB.id)).toEqual(before);
}

async function testCancelIgnoresForeignEventRow() {
  const { eventA, eventB, victim, victimSignupB } = await seedTwoEvents();
  // Legacy cross-event row: event A's roster pointing at B's signup.
  await placeRow(eventA, victimSignupB.id, 'dps');
  const res = await testApp.request
    .delete(`/events/${eventB}/signup`)
    .set('Authorization', `Bearer ${victim.token}`);
  expect(res.status).toBeLessThan(300);
  // B's cancel must not treat (or delete) event A's row as B's assignment.
  expect(await rosterRowsOf(eventA)).toEqual([
    expect.objectContaining({ signupId: victimSignupB.id, role: 'dps' }),
  ]);
}

/** Event A's legacy row for B's signup, untouched by whatever ran on B. */
async function expectForeignRowIntact(
  eventA: number,
  signupId: number,
  role: string,
) {
  expect(await rosterRowsOf(eventA)).toEqual([
    expect.objectContaining({ signupId, role, position: 1 }),
  ]);
}

async function testSelfUnassignIgnoresForeignEventRow() {
  const { eventA, eventB, victim, victimSignupB } = await seedTwoEvents();
  await placeRow(eventA, victimSignupB.id, 'dps');
  const res = await testApp.request
    .delete(`/events/${eventB}/roster/me`)
    .set('Authorization', `Bearer ${victim.token}`);
  // No slot on B: B has nothing to unassign, and A's row is not B's slot.
  expect(res.status).toBe(404);
  await expectForeignRowIntact(eventA, victimSignupB.id, 'dps');
}

async function testDiscordCancelIgnoresForeignEventRow() {
  const eventA = await createMmoEvent(testApp, adminToken);
  const eventB = await createMmoEvent(testApp, adminToken);
  const discordUserId = 'anon-rok-2321';
  const [anon] = await testApp.db
    .insert(schema.eventSignups)
    .values({
      eventId: eventB,
      discordUserId,
      discordUsername: 'anon-2321',
      status: 'signed_up',
      confirmationStatus: 'pending',
    })
    .returning();
  if (!anon) throw new Error('anonymous signup not inserted');
  await placeRow(eventA, anon.id, 'dps');
  await testApp.app
    .get(SignupsService)
    .cancelByDiscordUser(eventB, discordUserId);
  await expectForeignRowIntact(eventA, anon.id, 'dps');
}

async function testMoveToBenchIgnoresForeignEventRow() {
  const { eventA, eventB, victimSignupB } = await seedTwoEvents();
  await placeRow(eventA, victimSignupB.id, 'dps');
  const moved = await moveToBench(
    testApp.db,
    victimSignupB.id,
    eventB,
    new Logger('spec'),
  );
  expect(moved).toBeNull();
  await expectForeignRowIntact(eventA, victimSignupB.id, 'dps');
}

async function testRejoinReassignIgnoresForeignBenchRow() {
  const { eventA, eventB, victimSignupB } = await seedTwoEvents();
  await placeRow(eventA, victimSignupB.id, 'bench');
  const grace = testApp.app.get(DepartureGraceService);
  // Private step under test; B has open slots, so only the scope stops it.
  const slot = await grace['tryRosterReassignment'](eventB, victimSignupB.id);
  expect(slot).toBeNull();
  await expectForeignRowIntact(eventA, victimSignupB.id, 'bench');
}

async function testDemoCancelIgnoresForeignEventRow() {
  const { eventA, eventB, victim, victimSignupB } = await seedTwoEvents();
  await placeRow(eventA, victimSignupB.id, 'dps');
  await cancelSignup(
    testApp.db,
    eventB,
    victim.userId,
    testApp.app.get(BenchPromotionService),
    testApp.app.get(EventEmitter2),
    () => undefined,
  );
  await expectForeignRowIntact(eventA, victimSignupB.id, 'dps');
}

async function testCarryoverIgnoresForeignEventRole() {
  const { eventA, eventB, victim, victimSignupB } = await seedTwoEvents();
  // B (the follow-up source) never slotted the victim; A's row says tank.
  await placeRow(eventA, victimSignupB.id, 'tank');
  const poll = await testApp.request
    .post('/scheduling-polls')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ gameId: testApp.seed.game.id });
  expect(poll.status).toBe(201);
  const matchId: number = poll.body.id;
  await testApp.db
    .insert(schema.postEventFollowupSent)
    .values({ eventId: eventB, matchId });
  const carry = await loadFollowupCarryover(
    { db: testApp.db, logger: new Logger('spec') },
    { matchId, eventId: eventA },
    [victim.userId],
  );
  // No role, no character on B: nothing to carry, not A's 'tank'.
  expect(carry.get(victim.userId)).toBeUndefined();
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('Roster assignments stay inside their event (ROK-2321)', () => {
  it("rejects a PATCH carrying another event's signupId and leaves that event untouched", () =>
    testPatchWithForeignSignupIdRejected());
  it("cancelling on event B leaves event A's row for the same signup alone", () =>
    testCancelIgnoresForeignEventRow());
  it("self-unassign on B does not delete event A's row for the same signup", () =>
    testSelfUnassignIgnoresForeignEventRow());
  it("an anonymous Discord cancel on B leaves event A's row alone", () =>
    testDiscordCancelIgnoresForeignEventRow());
  it("departure-grace moveToBench on B does not bench event A's row", () =>
    testMoveToBenchIgnoresForeignEventRow());
  it("rejoin on B does not reslot event A's bench row", () =>
    testRejoinReassignIgnoresForeignBenchRow());
  it("the demo cancel helper on B leaves event A's row alone", () =>
    testDemoCancelIgnoresForeignEventRow());
  it("follow-up carryover from B ignores event A's roster role", () =>
    testCarryoverIgnoresForeignEventRole());
});
