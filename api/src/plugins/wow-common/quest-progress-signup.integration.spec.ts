/**
 * ROK-1757 — PUT quest-progress requires an active signup on the event and
 * rejects deactivated users (NotDeactivatedGuard).
 */
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { defined } from '../../common/testing/narrow';

let testApp: TestApp;

async function createMember(username: string, deactivated = false) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${username}@test.local`,
      username,
      role: 'member',
      deactivatedAt: deactivated ? new Date() : null,
    })
    .returning();
  return defined(user, username);
}

function tokenFor(user: { id: number; username: string }): Promise<string> {
  return signTestAccessToken(testApp, {
    sub: user.id,
    username: user.username,
  });
}

async function createEvent(): Promise<number> {
  const now = new Date();
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: 'Signup-gated quests',
      creatorId: testApp.seed.adminUser.id,
      duration: [now, new Date(now.getTime() + 3600_000)],
    })
    .returning();
  return defined(event, 'event').id;
}

async function signUp(eventId: number, userId: number, status = 'signed_up') {
  await testApp.db
    .insert(schema.eventSignups)
    .values({ eventId, userId, status });
}

function put(eventId: number, token: string) {
  return testApp.request
    .put(`/plugins/wow-classic/events/${eventId}/quest-progress`)
    .set('Authorization', `Bearer ${token}`)
    .send({ questId: 7001, pickedUp: true });
}

async function progressRows(eventId: number, userId: number) {
  const p = schema.wowClassicQuestProgress;
  return testApp.db
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.eventId, eventId), eq(p.userId, userId)));
}

describe('Quest progress PUT — signup + deactivation gate (ROK-1757)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('403 and no row for a member not signed up to the event', async () => {
    const eventId = await createEvent();
    const member = await createMember('qp-outsider');
    const res = await put(eventId, await tokenFor(member));
    expect(res.status).toBe(403);
    expect(await progressRows(eventId, member.id)).toEqual([]);
  });

  it('403 and no row for a member whose signup is declined', async () => {
    const eventId = await createEvent();
    const member = await createMember('qp-declined');
    await signUp(eventId, member.id, 'declined');
    const res = await put(eventId, await tokenFor(member));
    expect(res.status).toBe(403);
    expect(await progressRows(eventId, member.id)).toEqual([]);
  });

  it('401 USER_DEACTIVATED for a signed-up but deactivated member (JwtStrategy rejects first since ROK-1753)', async () => {
    const eventId = await createEvent();
    const member = await createMember('qp-gone', true);
    await signUp(eventId, member.id);
    const res = await put(eventId, await tokenFor(member));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'USER_DEACTIVATED' });
    expect(await progressRows(eventId, member.id)).toEqual([]);
  });

  it('200 and a row for a signed-up member', async () => {
    const eventId = await createEvent();
    const member = await createMember('qp-roster');
    await signUp(eventId, member.id);
    const res = await put(eventId, await tokenFor(member));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ eventId, userId: member.id });
    expect(await progressRows(eventId, member.id)).toHaveLength(1);
  });
});
