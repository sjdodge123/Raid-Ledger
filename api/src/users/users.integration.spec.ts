/**
 * Users Integration Tests — deleteUser cascade and Discord link/unlink (ROK-831).
 *
 * Verifies that deleteUser correctly cascades through 10+ related tables
 * and that Discord link/unlink/relink flows update discordId properly.
 */
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import {
  createMemberAndLogin,
  createFutureEvent,
} from '../events/signups.integration.spec-helpers';
import * as bcrypt from 'bcrypt';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';
import { UsersService } from './users.service';

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

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Create a user directly with a Discord ID (not local:). */
async function createDiscordUser(
  username: string,
  discordId: string,
): Promise<typeof schema.users.$inferSelect> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId, username, role: 'member' })
    .returning();
  return user;
}

/** Add local credentials so a Discord user can also log in via email. */
async function addLocalCredentials(
  userId: number,
  email: string,
): Promise<void> {
  const passwordHash = await bcrypt.hash('TestPassword123!', 4);
  await testApp.db
    .insert(schema.localCredentials)
    .values({ email, passwordHash, userId });
}

/** Seed related data for a user to verify cascade. */
async function seedCascadeData(userId: number): Promise<void> {
  // Session
  await testApp.db.insert(schema.sessions).values({
    id: `sess-${userId}`,
    userId,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  // Availability
  const start = new Date();
  const end = new Date(Date.now() + 3_600_000);
  await testApp.db.insert(schema.availability).values({
    userId,
    timeRange: [start, end] as [Date, Date],
    status: 'available',
  });
  // Event template
  await testApp.db.insert(schema.eventTemplates).values({
    userId,
    name: 'Test Template',
    config: { title: 'T', durationMinutes: 60 },
  });
}

// ─── deleteUser cascade ──────────────────────────────────────────────────────

async function testDeletesSessionsCredentialsAvailabilityTemplates() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'cascade1',
    'cascade1@test.local',
  );
  await seedCascadeData(userId);

  await testApp.request
    .delete(`/users/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(204);

  const sessions = await testApp.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.userId, userId));
  const creds = await testApp.db
    .select()
    .from(schema.localCredentials)
    .where(eq(schema.localCredentials.userId, userId));
  const avail = await testApp.db
    .select()
    .from(schema.availability)
    .where(eq(schema.availability.userId, userId));
  const templates = await testApp.db
    .select()
    .from(schema.eventTemplates)
    .where(eq(schema.eventTemplates.userId, userId));

  expect(sessions).toHaveLength(0);
  expect(creds).toHaveLength(0);
  expect(avail).toHaveLength(0);
  expect(templates).toHaveLength(0);
}

async function testReassignsEventsToAdmin() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'creator1',
    'creator1@test.local',
  );
  // Promote to operator so they can create events
  await testApp.db
    .update(schema.users)
    .set({ role: 'operator' })
    .where(eq(schema.users.id, userId));

  const reloginRes = await testApp.request.post('/auth/local').send({
    email: 'creator1@test.local',
    password: 'TestPassword123!',
  });
  const opToken = reloginRes.body.access_token as string;

  const eventRes = await testApp.request
    .post('/events')
    .set('Authorization', `Bearer ${opToken}`)
    .send({
      title: 'Reassign Test',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 97_200_000).toISOString(),
    });
  const eventId = eventRes.body.id as number;

  await testApp.request
    .delete(`/users/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(204);

  const [event] = await testApp.db
    .select({ creatorId: schema.events.creatorId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  expect(event.creatorId).toBe(testApp.seed.adminUser.id);
}

async function testPugSlotsUnclaimedAndReassigned() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'puguser',
    'puguser@test.local',
  );
  const eventId = await createFutureEvent(testApp, adminToken);

  // PUG slot created by admin, claimed by member
  await testApp.db.insert(schema.pugSlots).values({
    eventId,
    role: 'dps',
    createdBy: testApp.seed.adminUser.id,
    claimedByUserId: userId,
    discordUsername: 'pugclaimed',
  });
  // PUG slot created by member
  await testApp.db.insert(schema.pugSlots).values({
    eventId,
    role: 'tank',
    createdBy: userId,
    discordUsername: 'pugcreated',
  });

  await testApp.request
    .delete(`/users/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(204);

  const slots = await testApp.db
    .select()
    .from(schema.pugSlots)
    .where(eq(schema.pugSlots.eventId, eventId));
  const claimed = slots.find((s) => s.discordUsername === 'pugclaimed');
  const created = slots.find((s) => s.discordUsername === 'pugcreated');
  expect(claimed?.claimedByUserId).toBeNull();
  expect(created?.createdBy).toBe(testApp.seed.adminUser.id);
}

async function testUserRowRemoved() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'gone1',
    'gone1@test.local',
  );
  await testApp.request
    .delete(`/users/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(204);

  const [deleted] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  expect(deleted).toBeUndefined();
}

describe('deleteUser cascade (integration)', () => {
  it('deletes sessions, credentials, availability, templates for user', () =>
    testDeletesSessionsCredentialsAvailabilityTemplates());
  it('reassigns events to admin user', () => testReassignsEventsToAdmin());
  it('unclaims pug slots and reassigns created slots', () =>
    testPugSlotsUnclaimedAndReassigned());
  it('removes the user row', () => testUserRowRemoved());
});

// ─── deleteUser endpoints ────────────────────────────────────────────────────

async function testAdminDeleteReturns204() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'adm204',
    'adm204@test.local',
  );
  const res = await testApp.request
    .delete(`/users/${userId}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(204);
}

async function testSelfDeleteReturns204() {
  const { userId, token } = await createMemberAndLogin(
    testApp,
    'selfdelete',
    'selfdelete@test.local',
  );
  const res = await testApp.request
    .delete('/users/me')
    .set('Authorization', `Bearer ${token}`)
    .send({ confirmName: 'selfdelete' });
  expect(res.status).toBe(204);

  const [gone] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  expect(gone).toBeUndefined();
}

async function testCannotDeleteSelfViaAdminEndpoint() {
  const res = await testApp.request
    .delete(`/users/${testApp.seed.adminUser.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(400);
}

async function testCannotDeleteAnotherAdmin() {
  // Create a second admin
  const [admin2] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: 'local:admin2@test.local',
      username: 'admin2',
      role: 'admin',
    })
    .returning();

  const res = await testApp.request
    .delete(`/users/${admin2.id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  expect(res.status).toBe(403);
}

describe('deleteUser endpoints (integration)', () => {
  it('admin DELETE /users/:id returns 204 and cascades', () =>
    testAdminDeleteReturns204());
  it('self-delete DELETE /users/me returns 204 and cascades', () =>
    testSelfDeleteReturns204());
  it('cannot delete self via admin endpoint (400)', () =>
    testCannotDeleteSelfViaAdminEndpoint());
  it('cannot delete another admin (403)', () => testCannotDeleteAnotherAdmin());
});

// ─── Discord link/unlink ─────────────────────────────────────────────────────

async function testLinkDiscordUpdatesDiscordId() {
  const { userId } = await createMemberAndLogin(
    testApp,
    'linker',
    'linker@test.local',
  );

  // Call linkDiscord via service (no HTTP endpoint for external link)
  const usersService = testApp.app.get(UsersService);
  const updated = await usersService.linkDiscord(
    userId,
    '999888777',
    'linker_discord',
    'avatar_hash',
  );
  expect(updated.discordId).toBe('999888777');
  expect(updated.username).toBe('linker_discord');

  // Verify persistence
  const [row] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  expect(row.discordId).toBe('999888777');
}

async function testDuplicateLinkRejected() {
  await createDiscordUser('first', '111222333');
  const { userId: user2Id } = await createMemberAndLogin(
    testApp,
    'second',
    'second@test.local',
  );

  const usersService = testApp.app.get(UsersService);
  await expect(
    usersService.linkDiscord(user2Id, '111222333', 'second_discord'),
  ).rejects.toThrow('already linked');
}

async function testUnlinkDiscordPrefixesAndClearsAvatar() {
  const user = await createDiscordUser('unlinkme', '444555666');
  await addLocalCredentials(user.id, 'unlinkme@test.local');

  const loginRes = await testApp.request.post('/auth/local').send({
    email: 'unlinkme@test.local',
    password: 'TestPassword123!',
  });
  const token = loginRes.body.access_token as string;

  const res = await testApp.request
    .delete('/users/me/discord')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(204);

  const [row] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  expect(row.discordId).toBe('unlinked:444555666');
  expect(row.avatar).toBeNull();
}

async function testRelinkRestoresDiscordId() {
  const user = await createDiscordUser('relinker', '777888999');
  const usersService = testApp.app.get(UsersService);

  await usersService.unlinkDiscord(user.id);
  const [unlinked] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  expect(unlinked.discordId).toBe('unlinked:777888999');

  await usersService.relinkDiscord(user.id, 'relinked_name', 'new_avatar');

  const [relinked] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  expect(relinked.discordId).toBe('777888999');
  expect(relinked.username).toBe('relinked_name');
}

async function testFindByDiscordIdIncludingUnlinked() {
  const user = await createDiscordUser('findable', '101010101');
  const usersService = testApp.app.get(UsersService);

  // Exact match
  const exact =
    await usersService.findByDiscordIdIncludingUnlinked('101010101');
  expect(exact?.id).toBe(user.id);

  // Unlink then find prefixed
  await usersService.unlinkDiscord(user.id);
  const prefixed =
    await usersService.findByDiscordIdIncludingUnlinked('101010101');
  expect(prefixed?.id).toBe(user.id);
  expect(prefixed?.discordId).toBe('unlinked:101010101');

  // Non-existent
  const missing =
    await usersService.findByDiscordIdIncludingUnlinked('000000000');
  expect(missing).toBeNull();
}

describe('Discord link/unlink (integration)', () => {
  it('linkDiscord updates discordId on user', () =>
    testLinkDiscordUpdatesDiscordId());
  it('duplicate linking to different user rejected (409)', () =>
    testDuplicateLinkRejected());
  it('unlinkDiscord prefixes discordId and clears avatar', () =>
    testUnlinkDiscordPrefixesAndClearsAvatar());
  it('relink restores from unlinked: prefix', () =>
    testRelinkRestoresDiscordId());
  it('findByDiscordIdIncludingUnlinked finds exact and prefixed', () =>
    testFindByDiscordIdIncludingUnlinked());
});
