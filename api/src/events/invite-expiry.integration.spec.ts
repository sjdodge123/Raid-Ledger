/**
 * ROK-1757 — invite codes stop working once the event has ended or was
 * cancelled: resolve answers `valid: false`, claim is a 400, and nothing is
 * written. Locks the expiry behaviour for share links and PUG-slot links.
 */
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import { and, eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { defined } from '../common/testing/narrow';

let testApp: TestApp;
const HOUR = 3600_000;

type When = 'upcoming' | 'ended' | 'cancelled';

async function createEvent(when: When, inviteCode: string | null) {
  const start = Date.now() + (when === 'ended' ? -3 * HOUR : HOUR);
  const [event] = await testApp.db
    .insert(schema.events)
    .values({
      title: `Invite ${when}`,
      creatorId: testApp.seed.adminUser.id,
      duration: [new Date(start), new Date(start + HOUR)],
      inviteCode,
      cancelledAt: when === 'cancelled' ? new Date() : null,
    })
    .returning();
  return defined(event, 'event').id;
}

async function createMember(username: string) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({
      discordId: `local:${username}@test.local`,
      username,
      role: 'member',
    })
    .returning();
  const member = defined(user, username);
  const token = await signTestAccessToken(testApp, {
    sub: member.id,
    username: member.username,
  });
  return { id: member.id, token };
}

const claim = (code: string, token: string) =>
  testApp.request
    .post(`/invite/${code}/claim`)
    .set('Authorization', `Bearer ${token}`)
    .send({});

async function signupCount(eventId: number, userId: number) {
  const s = schema.eventSignups;
  const rows = await testApp.db
    .select({ id: s.id })
    .from(s)
    .where(and(eq(s.eventId, eventId), eq(s.userId, userId)));
  return rows.length;
}

describe('Invite codes expire with the event (ROK-1757)', () => {
  beforeAll(async () => {
    testApp = await getTestApp();
  });
  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
  });

  it('share link: claim before the event ends signs the member up', async () => {
    const eventId = await createEvent('upcoming', 'shareok2');
    const member = await createMember('inv-ok');
    const res = await claim('shareok2', member.token);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: 'signup', eventId });
    expect(await signupCount(eventId, member.id)).toBe(1);
  });

  it('share link: resolve and claim are rejected after the event ended', async () => {
    const eventId = await createEvent('ended', 'shareend');
    const member = await createMember('inv-late');
    const resolved = await testApp.request.get('/invite/shareend');
    expect(resolved.body).toEqual({
      valid: false,
      error: 'This event has already ended',
    });
    const res = await claim('shareend', member.token);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This event has already ended');
    expect(await signupCount(eventId, member.id)).toBe(0);
  });

  it('share link: claim is rejected once the event is cancelled', async () => {
    const eventId = await createEvent('cancelled', 'sharecnx');
    const member = await createMember('inv-cnx');
    const res = await claim('sharecnx', member.token);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This event has been cancelled');
    expect(await signupCount(eventId, member.id)).toBe(0);
  });

  it('PUG-slot link: resolve and claim are rejected after the event ended', async () => {
    const eventId = await createEvent('ended', null);
    await testApp.db.insert(schema.pugSlots).values({
      eventId,
      role: 'dps',
      inviteCode: 'pugended',
      createdBy: testApp.seed.adminUser.id,
    });
    const member = await createMember('inv-pug');
    const resolved = await testApp.request.get('/invite/pugended');
    expect(resolved.body).toMatchObject({ valid: false });
    const res = await claim('pugended', member.token);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('This event has already ended');
    expect(await signupCount(eventId, member.id)).toBe(0);
  });
});
