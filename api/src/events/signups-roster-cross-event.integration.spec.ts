/**
 * ROK-2321 — a roster_assignments row must never reach across events.
 *
 * 1. PATCH /events/A/roster with a signupId from event B is a 400 and leaves
 *    B's signup and B's roster row exactly as they were.
 * 2. Signup-keyed readers are scoped to their event: a row event A holds for
 *    B's signup (the shape the PATCH could write before ROK-2141) is not
 *    treated as B's assignment when the B signup is cancelled.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { eq } from 'drizzle-orm';
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
});
