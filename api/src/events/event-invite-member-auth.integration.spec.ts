/**
 * ROK-2217: POST /events/:id/invite-member against a real DB and the real
 * jwt + NotDeactivatedGuard + InviteMemberThrottleGuard wiring. Managers
 * (creator, operator/admin) always invite; a non-manager only while holding a
 * signed_up/tentative signup; 10 invites/min per user. Unit coverage of the
 * rule lives in invite-member-auth.spec.ts. Review round 1: cancelled/ended
 * events refuse invites (400, managers too) and a repeat invite to the same
 * member is skipped (201, no second notification/DM).
 */
import { and, eq } from 'drizzle-orm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MEMBER_INVITE_EVENTS } from '../discord-bot/discord-bot.constants';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { INVITE_MEMBER_FORBIDDEN_MESSAGE } from './event-invite.helpers';
import {
  INVITE_EVENT_CANCELLED_MESSAGE,
  INVITE_EVENT_ENDED_MESSAGE,
} from './event-invite-state.helpers';
import {
  INVITE_MEMBER_LIMIT,
  InviteMemberThrottleGuard,
} from './invite-member-throttle.guard';
import {
  createFutureEvent,
  createMemberAndLogin,
} from './signups.integration.spec-helpers';

type SignupStatus = 'signed_up' | 'tentative' | 'declined';

let testApp: TestApp;
let adminToken: string;

/** A registered user with a real Discord id to receive the invite. */
async function seedInvitee(): Promise<{ userId: number; discordId: string }> {
  const discordId = 'discord-invitee-2217';
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username: 'invitee_2217', role: 'member' })
      .returning({ id: schema.users.id }),
    'invitee',
  );
  return { userId: user.id, discordId };
}

async function seedSignup(
  eventId: number,
  userId: number,
  status: SignupStatus,
) {
  await testApp.db.insert(schema.eventSignups).values({
    eventId,
    userId,
    status,
    confirmationStatus: 'confirmed',
  });
}

function inviteAs(token: string, eventId: number, discordId: string) {
  return testApp.request
    .post(`/events/${eventId}/invite-member`)
    .set('Authorization', `Bearer ${token}`)
    .send({ discordId });
}

/** "Event Invitation" notifications `userId` holds. */
async function inviteCount(userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.title, 'Event Invitation'),
      ),
    );
  return rows.length;
}

/** An admin-created event, its invitee, and a member with `status` on it. */
async function sceneWithMember(name: string, status: SignupStatus | null) {
  const eventId = await createFutureEvent(testApp, adminToken);
  const invitee = await seedInvitee();
  const member = await createMemberAndLogin(
    testApp,
    name,
    `${name}@test.local`,
  );
  if (status) await seedSignup(eventId, member.userId, status);
  return { eventId, invitee, member };
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  testApp.app.get(InviteMemberThrottleGuard, { strict: false }).reset();
});

afterEach(async () => {
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

async function testCreatorInvites() {
  const creator = await createMemberAndLogin(testApp, 'org', 'org@test.local');
  const eventId = await createFutureEvent(testApp, creator.token);
  const invitee = await seedInvitee();
  const res = await inviteAs(creator.token, eventId, invitee.discordId);
  expect({
    status: res.status,
    invites: await inviteCount(invitee.userId),
  }).toEqual({ status: 201, invites: 1 });
}

async function testAdminInvitesOnOthersEvent() {
  const creator = await createMemberAndLogin(
    testApp,
    'org2',
    'org2@test.local',
  );
  const eventId = await createFutureEvent(testApp, creator.token);
  const invitee = await seedInvitee();
  const res = await inviteAs(adminToken, eventId, invitee.discordId);
  expect(res.status).toBe(201);
}

async function testAllowed(status: 'signed_up' | 'tentative') {
  const { eventId, invitee, member } = await sceneWithMember(
    `m_${status}`,
    status,
  );
  const res = await inviteAs(member.token, eventId, invitee.discordId);
  expect({
    status: res.status,
    invites: await inviteCount(invitee.userId),
  }).toEqual({ status: 201, invites: 1 });
}

async function testRefused(name: string, status: SignupStatus | null) {
  const { eventId, invitee, member } = await sceneWithMember(name, status);
  const res = await inviteAs(member.token, eventId, invitee.discordId);
  expect({
    status: res.status,
    message: res.body.message,
    invites: await inviteCount(invitee.userId),
  }).toEqual({
    status: 403,
    message: INVITE_MEMBER_FORBIDDEN_MESSAGE,
    invites: 0,
  });
}

async function testRateLimit() {
  const { eventId, invitee, member } = await sceneWithMember(
    'burst',
    'signed_up',
  );
  const statuses: number[] = [];
  for (let i = 0; i <= INVITE_MEMBER_LIMIT; i += 1) {
    const res = await inviteAs(member.token, eventId, invitee.discordId);
    statuses.push(res.status);
  }
  const expected = [...Array<number>(INVITE_MEMBER_LIMIT).fill(201), 429];
  expect(statuses).toEqual(expected);
}

/** A member promoted to operator, logged in again so the token is fresh. */
async function operatorLogin(): Promise<string> {
  const email = 'op2217@test.local';
  const op = await createMemberAndLogin(testApp, 'op2217', email);
  await testApp.db
    .update(schema.users)
    .set({ role: 'operator' })
    .where(eq(schema.users.id, op.userId));
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  expect([200, 201]).toContain(res.status);
  return res.body.access_token as string;
}

async function testOperatorInvitesOnOthersEvent() {
  const creator = await createMemberAndLogin(testApp, 'org3', 'o3@test.local');
  const eventId = await createFutureEvent(testApp, creator.token);
  const invitee = await seedInvitee();
  const res = await inviteAs(await operatorLogin(), eventId, invitee.discordId);
  expect({
    status: res.status,
    invites: await inviteCount(invitee.userId),
  }).toEqual({ status: 201, invites: 1 });
}

/** An admin (manager) inviting to an event that `close` has closed. */
async function testClosedEvent(
  close: Partial<typeof schema.events.$inferInsert>,
  message: string,
) {
  const eventId = await createFutureEvent(testApp, adminToken);
  await testApp.db
    .update(schema.events)
    .set(close)
    .where(eq(schema.events.id, eventId));
  const invitee = await seedInvitee();
  const res = await inviteAs(adminToken, eventId, invitee.discordId);
  expect({
    status: res.status,
    message: res.body.message,
    invites: await inviteCount(invitee.userId),
  }).toEqual({ status: 400, message, invites: 0 });
}

function endedDuration(): [Date, Date] {
  const end = new Date(Date.now() - 60 * 60 * 1000);
  return [new Date(end.getTime() - 3 * 60 * 60 * 1000), end];
}

async function testRepeatInviteSkipped() {
  const { eventId, invitee, member } = await sceneWithMember(
    'repeat',
    'signed_up',
  );
  const first = await inviteAs(member.token, eventId, invitee.discordId);
  const again = await inviteAs(member.token, eventId, invitee.discordId);
  const byAdmin = await inviteAs(adminToken, eventId, invitee.discordId);
  expect({
    statuses: [first.status, again.status, byAdmin.status],
    repeatMessage: again.body.message,
    alreadyInvited: [first.body.alreadyInvited, again.body.alreadyInvited],
    invites: await inviteCount(invitee.userId),
  }).toEqual({
    statuses: [201, 201, 201],
    repeatMessage: 'invitee_2217 already has an invite to this event',
    alreadyInvited: [false, true],
    invites: 1,
  });
}

/** Codex P2: two simultaneous invites to one member claim it exactly once. */
async function testConcurrentInvitesClaimOnce() {
  const eventId = await createFutureEvent(testApp, adminToken);
  const invitee = await seedInvitee();
  const emitter = testApp.app.get(EventEmitter2, { strict: false });
  const emitSpy = jest.spyOn(emitter, 'emit');
  try {
    const [a, b] = await Promise.all([
      inviteAs(adminToken, eventId, invitee.discordId),
      inviteAs(adminToken, eventId, invitee.discordId),
    ]);
    const dms = emitSpy.mock.calls.filter(
      ([name]) => name === MEMBER_INVITE_EVENTS.CREATED,
    ).length;
    expect({
      statuses: [a.status, b.status],
      alreadyInvited: [a.body.alreadyInvited, b.body.alreadyInvited].sort(),
      invites: await inviteCount(invitee.userId),
      dms,
    }).toEqual({
      statuses: [201, 201],
      alreadyInvited: [false, true],
      invites: 1,
      dms: 1,
    });
  } finally {
    emitSpy.mockRestore();
  }
}

describe('ROK-2217 POST /events/:id/invite-member authorisation', () => {
  it('the event creator may invite', () => testCreatorInvites());
  it("an admin may invite on someone else's event", () =>
    testAdminInvitesOnOthersEvent());
  it('a signed-up non-manager may invite', () => testAllowed('signed_up'));
  it('a tentative non-manager may invite', () => testAllowed('tentative'));
  it('a non-manager with no signup gets 403 and sends nothing', () =>
    testRefused('stranger', null));
  it('a declined non-manager gets 403 and sends nothing', () =>
    testRefused('decliner', 'declined'));
  it('the 11th invite in a minute from one user gets 429', () =>
    testRateLimit());
  it("an operator may invite on someone else's event", () =>
    testOperatorInvitesOnOthersEvent());
  it('a cancelled event refuses invites with 400, even for a manager', () =>
    testClosedEvent(
      { cancelledAt: new Date() },
      INVITE_EVENT_CANCELLED_MESSAGE,
    ));
  it('an ended event refuses invites with 400, even for a manager', () =>
    testClosedEvent({ duration: endedDuration() }, INVITE_EVENT_ENDED_MESSAGE));
  it('a repeat invite to the same member is skipped — no second DM', () =>
    testRepeatInviteSkipped());
  it('two concurrent invites to one member send one DM', () =>
    testConcurrentInvitesClaimOnce());
});
