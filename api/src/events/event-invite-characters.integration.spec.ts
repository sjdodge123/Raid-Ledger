/**
 * ROK-2215: POST /events/:id/invite-characters against a real DB and the
 * real jwt + NotDeactivatedGuard wiring. Unit coverage of the planner and
 * controller lives in event-invite-characters.helpers.spec.ts and
 * events.controller.invite-characters.spec.ts; this file proves the route,
 * the creator/staff check, the skips and the notification side effects.
 *
 * I7 (invite-member unchanged) is covered by the four untouched tests in
 * events-dashboard.actions.integration.spec.ts → "Events — invite member".
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as bcrypt from 'bcrypt';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import { MEMBER_INVITE_EVENTS } from '../discord-bot/discord-bot.constants';

type Role = 'member' | 'operator' | 'admin';

interface Login {
  userId: number;
  token: string;
}

let testApp: TestApp;
let adminToken: string;
let emitSpy: jest.SpyInstance;
let seq = 0;

/** Inserts a user with local credentials and logs them in. */
async function createUserAndLogin(
  username: string,
  discordId: string,
  role: Role = 'member',
): Promise<Login> {
  seq += 1;
  const email = `ic-${seq}-${username}@test.local`;
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  const [user] = nonEmpty(
    await testApp.db
      .insert(schema.users)
      .values({ discordId, username, role })
      .returning(),
    `user ${username}`,
  );
  await testApp.db
    .insert(schema.localCredentials)
    .values({ email, passwordHash, userId: user.id });
  const res = await testApp.request
    .post('/auth/local')
    .send({ email, password: 'TestPassword123!' });
  if (res.status !== 201 && res.status !== 200)
    throw new Error(`login ${username} failed: ${res.status}`);
  return { userId: user.id, token: res.body.access_token as string };
}

/** Inserts a character owned by `userId` on the seeded game; returns its id. */
async function createCharacter(userId: number, name: string): Promise<string> {
  const [row] = nonEmpty(
    await testApp.db
      .insert(schema.characters)
      .values({ userId, gameId: testApp.seed.game.id, name })
      .returning({ id: schema.characters.id }),
    `character ${name}`,
  );
  return row.id;
}

/** Creates a future event as the holder of `token`; returns its id. */
async function createEventAs(token: string): Promise<number> {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const res = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'Dungeon Plan Run',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    });
  if (res.status !== 201) throw new Error(`createEvent failed: ${res.status}`);
  return res.body.id as number;
}

function invite(token: string, eventId: number, body: object) {
  return testApp.request
    .post(`/events/${eventId}/invite-characters`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

/** Count of "Event Invitation" notifications `userId` holds. */
async function inviteNotificationCount(userId: number): Promise<number> {
  const rows = await testApp.db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, 'new_event'),
        eq(schema.notifications.title, 'Event Invitation'),
      ),
    );
  return rows.length;
}

/** Number of MEMBER_INVITE_EVENTS.CREATED emits since the spy was set. */
function inviteEmitCount(): number {
  return emitSpy.mock.calls.filter(
    (call: unknown[]) => call[0] === MEMBER_INVITE_EVENTS.CREATED,
  ).length;
}

/** The organiser C plus two invitees with real Discord ids. */
async function setupCreatorAndTwoOwners() {
  const creator = await createUserAndLogin('creator_c', 'discord-c');
  const u1 = await createUserAndLogin('owner_u1', 'discord-u1');
  const u2 = await createUserAndLogin('owner_u2', 'discord-u2');
  const eventId = await createEventAs(creator.token);
  const charA = await createCharacter(u1.userId, 'Aria');
  const charB = await createCharacter(u2.userId, 'Brann');
  return { creator, u1, u2, eventId, charA, charB };
}

beforeAll(async () => {
  testApp = await getTestApp();
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

beforeEach(() => {
  emitSpy = jest.spyOn(testApp.app.get(EventEmitter2), 'emit');
});

afterEach(async () => {
  emitSpy.mockRestore();
  testApp.seed = await truncateAllTables(testApp.db);
  adminToken = await loginAsAdmin(testApp.request, testApp.seed);
});

// ─── I1: happy path ─────────────────────────────────────────────────────────

async function testInvitesBothOwners() {
  const { creator, u1, u2, eventId, charA, charB } =
    await setupCreatorAndTwoOwners();
  const res = await invite(creator.token, eventId, {
    characterIds: [charA, charB],
  });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({
    invited: [
      { characterId: charA, characterName: 'Aria', username: 'owner_u1' },
      { characterId: charB, characterName: 'Brann', username: 'owner_u2' },
    ],
    skipped: [],
  });
  expect(await inviteNotificationCount(u1.userId)).toBe(1);
  expect(await inviteNotificationCount(u2.userId)).toBe(1);
  expect(inviteEmitCount()).toBe(2);
  for (const targetDiscordId of ['discord-u1', 'discord-u2']) {
    expect(emitSpy).toHaveBeenCalledWith(
      MEMBER_INVITE_EVENTS.CREATED,
      expect.objectContaining({ eventId, targetDiscordId }),
    );
  }
}

// ─── I2: placeholder Discord id ─────────────────────────────────────────────

async function testSkipsPlaceholderDiscord() {
  const { creator, u1, eventId, charA } = await setupCreatorAndTwoOwners();
  const u3 = await createUserAndLogin('owner_u3', 'local:u3@test.local');
  const charC = await createCharacter(u3.userId, 'Cara');
  const res = await invite(creator.token, eventId, {
    characterIds: [charC, charA],
  });
  expect(res.status).toBe(201);
  expect(res.body.skipped).toEqual([
    { characterId: charC, characterName: 'Cara', reason: 'no_discord' },
  ]);
  expect(res.body.invited).toEqual([
    { characterId: charA, characterName: 'Aria', username: 'owner_u1' },
  ]);
  // Mutation proof: without the isLinkedDiscordId check U3 gets 1 here.
  expect(await inviteNotificationCount(u3.userId)).toBe(0);
  expect(await inviteNotificationCount(u1.userId)).toBe(1);
  expect(inviteEmitCount()).toBe(1);
}

// ─── I3: dedupe per owner, caller's own character dropped ───────────────────

async function testDedupesOwnerAndDropsCallersOwn() {
  const { creator, u1, eventId, charA } = await setupCreatorAndTwoOwners();
  const charA2 = await createCharacter(u1.userId, 'Aria Alt');
  const ownChar = await createCharacter(creator.userId, 'Cedric');
  const res = await invite(creator.token, eventId, {
    characterIds: [charA, charA2, ownChar],
  });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({
    invited: [
      { characterId: charA, characterName: 'Aria', username: 'owner_u1' },
    ],
    skipped: [],
  });
  expect(await inviteNotificationCount(u1.userId)).toBe(1);
  expect(await inviteNotificationCount(creator.userId)).toBe(0);
  expect(inviteEmitCount()).toBe(1);
}

// ─── I4: already signed up ──────────────────────────────────────────────────

async function testSkipsAlreadySignedUp() {
  const { creator, u1, u2, eventId, charA, charB } =
    await setupCreatorAndTwoOwners();
  const signup = await testApp.request
    .post(`/events/${eventId}/signup`)
    .set('Authorization', `Bearer ${u1.token}`)
    .send({});
  expect(signup.status).toBe(201);
  const res = await invite(creator.token, eventId, {
    characterIds: [charA, charB],
  });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({
    invited: [
      { characterId: charB, characterName: 'Brann', username: 'owner_u2' },
    ],
    skipped: [
      {
        characterId: charA,
        characterName: 'Aria',
        reason: 'already_signed_up',
      },
    ],
  });
  expect(await inviteNotificationCount(u1.userId)).toBe(0);
  expect(await inviteNotificationCount(u2.userId)).toBe(1);
}

// ─── I5: who may invite ─────────────────────────────────────────────────────

async function testNonCreatorMemberForbidden() {
  const { u1, eventId, charA } = await setupCreatorAndTwoOwners();
  const other = await createUserAndLogin('bystander', 'discord-bystander');
  const res = await invite(other.token, eventId, { characterIds: [charA] });
  // Mutation proof: without the creator check this is 201.
  expect(res.status).toBe(403);
  expect(await inviteNotificationCount(u1.userId)).toBe(0);
  expect(inviteEmitCount()).toBe(0);
}

async function testOperatorNonCreatorAllowed() {
  const { u1, eventId, charA } = await setupCreatorAndTwoOwners();
  const op = await createUserAndLogin('op_user', 'discord-op', 'operator');
  const res = await invite(op.token, eventId, { characterIds: [charA] });
  expect(res.status).toBe(201);
  expect(res.body.invited).toEqual([
    { characterId: charA, characterName: 'Aria', username: 'owner_u1' },
  ]);
  expect(await inviteNotificationCount(u1.userId)).toBe(1);
}

async function testAdminInvitesCreatorsCharacter() {
  const { creator, eventId } = await setupCreatorAndTwoOwners();
  const creatorChar = await createCharacter(creator.userId, 'Cedric');
  const res = await invite(adminToken, eventId, {
    characterIds: [creatorChar],
  });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({
    invited: [
      {
        characterId: creatorChar,
        characterName: 'Cedric',
        username: 'creator_c',
      },
    ],
    skipped: [],
  });
  expect(await inviteNotificationCount(creator.userId)).toBe(1);
}

// ─── I6: body validation, unknown ids, unknown event ────────────────────────

const SIX_IDS = Array.from({ length: 6 }, () => randomUUID());

const BAD_BODIES: Array<[string, object]> = [
  ['an empty list', { characterIds: [] }],
  ['six ids', { characterIds: SIX_IDS }],
  ['a non-uuid', { characterIds: ['not-a-uuid'] }],
  ['an extra key', { characterIds: [randomUUID()], note: 'hi' }],
  ['no characterIds', {}],
];

async function testRejectsBadBody(body: object) {
  const { creator, eventId } = await setupCreatorAndTwoOwners();
  const res = await invite(creator.token, eventId, body);
  expect(res.status).toBe(400);
  expect(inviteEmitCount()).toBe(0);
}

async function testUnknownCharacterNotFound() {
  const { creator, u1, eventId, charA } = await setupCreatorAndTwoOwners();
  const ghost = randomUUID();
  const res = await invite(creator.token, eventId, {
    characterIds: [ghost, charA],
  });
  expect(res.status).toBe(201);
  expect(res.body).toEqual({
    invited: [
      { characterId: charA, characterName: 'Aria', username: 'owner_u1' },
    ],
    skipped: [{ characterId: ghost, characterName: null, reason: 'not_found' }],
  });
  expect(await inviteNotificationCount(u1.userId)).toBe(1);
}

async function testUnknownEvent404() {
  const { creator, charA } = await setupCreatorAndTwoOwners();
  const res = await invite(creator.token, 999_999, { characterIds: [charA] });
  expect(res.status).toBe(404);
}

async function testUnauthenticated401() {
  const { eventId, charA } = await setupCreatorAndTwoOwners();
  const res = await testApp.request
    .post(`/events/${eventId}/invite-characters`)
    .send({ characterIds: [charA] });
  expect(res.status).toBe(401);
}

describe('POST /events/:id/invite-characters (ROK-2215)', () => {
  it('I1: creator invites two owners — notification + DM emit each', () =>
    testInvitesBothOwners());
  it('I2: a placeholder Discord owner is skipped no_discord, not notified', () =>
    testSkipsPlaceholderDiscord());
  it("I3: one invite per owner; the caller's own character is dropped", () =>
    testDedupesOwnerAndDropsCallersOwn());
  it('I4: an owner already signed up is skipped; others still invited', () =>
    testSkipsAlreadySignedUp());
  it('I5: a non-creator member gets 403 and nobody is notified', () =>
    testNonCreatorMemberForbidden());
  it('I5: an operator who did not create the event may invite', () =>
    testOperatorNonCreatorAllowed());
  it("I5: an admin may invite the creator's own character", () =>
    testAdminInvitesCreatorsCharacter());
  it.each(BAD_BODIES)('I6: rejects %s with 400', (_label, body) =>
    testRejectsBadBody(body),
  );
  it('I6: an unknown character id is skipped not_found (201)', () =>
    testUnknownCharacterNotFound());
  it('I6: an unknown event is 404', () => testUnknownEvent404());
  it('rejects an unauthenticated caller with 401', () =>
    testUnauthenticated401());
});
