/**
 * ROK-2141 — anonymous Discord signups (event_signups.user_id IS NULL) can be
 * assigned to roster slots via PATCH /events/:id/roster. Roster writes are
 * keyed on signupId; an anonymous entry carries userId 0.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { nonEmpty } from '../common/testing/narrow';
import {
  createMemberAndLogin,
  createMmoEvent,
  signupViaDb,
  getSignupAssignment,
} from './signups.integration.spec-helpers';

let testApp: TestApp;
let adminToken: string;

/** Insert an anonymous Discord signup (no linked RL user). */
async function anonSignup(
  eventId: number,
  discordUserId: string,
): Promise<typeof schema.eventSignups.$inferSelect> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId: null,
        discordUserId,
        discordUsername: `anon-${discordUserId}`,
        status: 'signed_up',
        confirmationStatus: 'pending',
      })
      .returning(),
    'inserted anonymous signup',
  );
  return row;
}

function patchRoster(eventId: number, assignments: unknown[]) {
  return testApp.request
    .patch(`/events/${eventId}/roster`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ assignments });
}

async function testAnonAssignmentPersists() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const anon = await anonSignup(eventId, '900000000000000001');
  const res = await patchRoster(eventId, [
    { userId: 0, signupId: anon.id, slot: 'dps', position: 1 },
  ]);
  expect(res.status).toBe(200);
  const row = await getSignupAssignment(testApp, anon.id);
  expect(row).toMatchObject({ role: 'dps', position: 1 });
}

async function testRepatchKeepsAnonAssignment() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const anon = await anonSignup(eventId, '900000000000000002');
  const { userId } = await createMemberAndLogin(
    testApp,
    'rosteredmember',
    'rosteredmember@test.local',
  );
  const member = await signupViaDb(testApp, eventId, userId);
  const anonEntry = { userId: 0, signupId: anon.id, slot: 'dps', position: 1 };
  const memberAt = (slot: string) => ({
    userId,
    signupId: member.id,
    slot,
    position: 1,
  });
  expect(
    (await patchRoster(eventId, [anonEntry, memberAt('tank')])).status,
  ).toBe(200);
  const second = await patchRoster(eventId, [anonEntry, memberAt('healer')]);
  expect(second.status).toBe(200);
  expect(await getSignupAssignment(testApp, anon.id)).toMatchObject({
    role: 'dps',
    position: 1,
  });
  expect(await getSignupAssignment(testApp, member.id)).toMatchObject({
    role: 'healer',
  });
}

async function testForeignSignupIdRejected() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const otherEventId = await createMmoEvent(testApp, adminToken);
  const foreign = await anonSignup(otherEventId, '900000000000000003');
  const res = await patchRoster(eventId, [
    { userId: 0, signupId: foreign.id, slot: 'dps', position: 1 },
  ]);
  expect(res.status).toBe(400);
  expect(await getSignupAssignment(testApp, foreign.id)).toBeUndefined();
}

async function testMismatchedUserIdRejected() {
  const eventId = await createMmoEvent(testApp, adminToken);
  const anon = await anonSignup(eventId, '900000000000000004');
  const { userId } = await createMemberAndLogin(
    testApp,
    'mismatchmember',
    'mismatchmember@test.local',
  );
  const res = await patchRoster(eventId, [
    { userId, signupId: anon.id, slot: 'dps', position: 1 },
  ]);
  expect(res.status).toBe(400);
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

describe('PATCH /events/:id/roster — anonymous signups (ROK-2141)', () => {
  it('assigns an anonymous signup to a dps slot and persists it', () =>
    testAnonAssignmentPersists());
  it('keeps the anonymous assignment across a later roster edit', () =>
    testRepatchKeepsAnonAssignment());
  it('rejects a signupId that belongs to another event', () =>
    testForeignSignupIdRejected());
  it('rejects a userId that does not own the given signupId', () =>
    testMismatchedUserIdRejected());
});
