/**
 * ROK-1825 — a PUG slot's invite code is a bearer credential for that slot.
 *
 * Only the event's creator and operators/admins (the `verifyEventPermission`
 * rule every mutating PUG route already uses) may read `inviteCode` /
 * `serverInviteUrl`, on BOTH `GET /events/:id/pugs` and the detail bundle.
 * A slot reserved for a named Discord user can only be claimed by that user.
 */
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import * as schema from '../drizzle/schema';
import { clearAuthUserCache } from '../auth/auth-user-cache';
import {
  createMemberAndLogin,
  createFutureEvent,
} from './signups.integration.spec-helpers';

const PUG_SNOWFLAKE = '555555555555555555';
const INVITE_CODE = 'pugcode1';
const SERVER_INVITE = 'https://discord.gg/pugserver';

let testApp: TestApp;
let adminToken: string;

interface Fixture {
  eventId: number;
  memberToken: string;
  creatorToken: string;
}

type PugRow = Record<string, unknown>;

async function seedFixture(): Promise<Fixture> {
  const eventId = await createFutureEvent(testApp, adminToken);
  const member = await createMemberAndLogin(testApp, 'mem', 'mem@test.local');
  const creator = await createMemberAndLogin(testApp, 'own', 'own@test.local');
  await testApp.db
    .update(schema.events)
    .set({ creatorId: creator.userId })
    .where(eq(schema.events.id, eventId));
  await testApp.db.insert(schema.pugSlots).values({
    eventId,
    role: 'dps',
    status: 'invited',
    discordUsername: 'pugguy',
    discordUserId: PUG_SNOWFLAKE,
    inviteCode: INVITE_CODE,
    serverInviteUrl: SERVER_INVITE,
    createdBy: creator.userId,
  });
  return { eventId, memberToken: member.token, creatorToken: creator.token };
}

/** The invite fields of every slot, from the list route AND the detail bundle. */
async function inviteFieldsFor(eventId: number, token: string) {
  const list = await testApp.request
    .get(`/events/${eventId}/pugs`)
    .set('Authorization', `Bearer ${token}`);
  const detail = await testApp.request
    .get(`/events/${eventId}/detail`)
    .set('Authorization', `Bearer ${token}`);
  const pick = (rows: PugRow[]) =>
    rows.map((p) => ({
      inviteCode: p.inviteCode,
      serverInviteUrl: p.serverInviteUrl,
    }));
  return {
    status: [list.status, detail.status],
    list: pick((list.body as { pugs: PugRow[] }).pugs),
    detail: pick((detail.body as { pugs: PugRow[] }).pugs),
  };
}

const VISIBLE = [{ inviteCode: INVITE_CODE, serverInviteUrl: SERVER_INVITE }];
const HIDDEN = [{ inviteCode: null, serverInviteUrl: null }];

describe('ROK-1825 PUG invite code visibility + claim binding (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    testApp = await getTestApp();
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
  });

  beforeEach(async () => {
    f = await seedFixture();
  });

  afterEach(async () => {
    testApp.seed = await truncateAllTables(testApp.db);
    adminToken = await loginAsAdmin(testApp.request, testApp.seed);
    clearAuthUserCache();
  });

  it('a plain member gets no inviteCode or serverInviteUrl in list or detail', async () => {
    expect(await inviteFieldsFor(f.eventId, f.memberToken)).toEqual({
      status: [200, 200],
      list: HIDDEN,
      detail: HIDDEN,
    });
  });

  it('a plain member still sees the slot and its Discord identity', async () => {
    const res = await testApp.request
      .get(`/events/${f.eventId}/pugs`)
      .set('Authorization', `Bearer ${f.memberToken}`);
    const pugs = (res.body as { pugs: PugRow[] }).pugs;
    expect(pugs.map((p) => [p.discordUsername, p.discordUserId])).toEqual([
      ['pugguy', PUG_SNOWFLAKE],
    ]);
  });

  it.each([
    ['event creator', () => f.creatorToken],
    ['admin', () => adminToken],
  ] as const)('the %s still gets the invite fields', async (_l, token) => {
    expect(await inviteFieldsFor(f.eventId, token())).toEqual({
      status: [200, 200],
      list: VISIBLE,
      detail: VISIBLE,
    });
  });

  it('a member who is not the reserved invitee cannot claim the slot', async () => {
    const res = await testApp.request
      .post(`/invite/${INVITE_CODE}/claim`)
      .set('Authorization', `Bearer ${f.memberToken}`)
      .send({});
    expect({ status: res.status, message: res.body.message }).toEqual({
      status: 403,
      message: 'This invite is reserved for another player',
    });
    const [slot] = await testApp.db
      .select({ status: schema.pugSlots.status })
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.inviteCode, INVITE_CODE));
    expect(slot?.status).toBe('invited');
  });

  it('the reserved invitee can still claim the slot', async () => {
    const pug = await createMemberAndLogin(testApp, 'pug', 'pug@test.local');
    await testApp.db
      .update(schema.users)
      .set({ discordId: PUG_SNOWFLAKE })
      .where(eq(schema.users.id, pug.userId));
    const res = await testApp.request
      .post(`/invite/${INVITE_CODE}/claim`)
      .set('Authorization', `Bearer ${pug.token}`)
      .send({});
    expect({ status: res.status, eventId: res.body.eventId }).toEqual({
      status: 201,
      eventId: f.eventId,
    });
  });
});
