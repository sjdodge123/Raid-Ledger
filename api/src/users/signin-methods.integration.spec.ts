/**
 * ROK-2371 — sign-in methods + the last-method guard (spec §3, §5; AC 8–10).
 *
 * Real controllers, guards and Postgres: both unlink routes incl. a
 * Discord-only user being refused (ruling 10), `/auth/me` `signinMethods`, the "Allow sign-in with
 * Google" admin toggle (400 without a client, round-trip with one) and the
 * self-delete path removing identity rows.
 */
import { eq } from 'drizzle-orm';
import * as bcrypt from 'bcrypt';
import { SigninMethodsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { signTestAccessToken } from '../common/testing/sign-test-access-token';
import * as schema from '../drizzle/schema';

const ADMIN_ROUTE = '/admin/settings/calendar-sync';
const GOOGLE_EMAIL = 'rok2371-person@example.test';

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

interface Fixture {
  discordId?: string | null;
  google?: boolean;
  password?: boolean;
}

/** Create a member with exactly the given sign-in methods + a session. */
async function makeUser(name: string, f: Fixture) {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: f.discordId ?? null, username: name, role: 'member' })
    .returning();
  if (!user) throw new Error(`makeUser: insert returned no row for ${name}`);
  if (f.google) {
    await testApp.db.insert(schema.userAuthIdentities).values({
      userId: user.id,
      provider: 'google',
      subject: `sub-${name}`,
      email: GOOGLE_EMAIL,
    });
  }
  if (f.password) {
    await testApp.db.insert(schema.localCredentials).values({
      email: `${name}@test.local`,
      passwordHash: await bcrypt.hash('TestPassword123!', 4),
      userId: user.id,
    });
  }
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username: name,
    role: 'member',
  });
  return { userId: user.id, token };
}

function del(path: string, token: string) {
  return testApp.request.delete(path).set('Authorization', `Bearer ${token}`);
}

async function googleRows(userId: number) {
  return testApp.db
    .select()
    .from(schema.userAuthIdentities)
    .where(eq(schema.userAuthIdentities.userId, userId));
}

async function discordIdOf(userId: number) {
  const [row] = await testApp.db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  if (!row) throw new Error(`discordIdOf: no user ${userId}`);
  return row.discordId;
}

function expectLastMethod409(res: { status: number; body: unknown }) {
  expect(res.status).toBe(409);
  expect(res.body).toMatchObject({
    code: 'LAST_SIGNIN_METHOD',
    message: 'Add another way to sign in first',
  });
}

describe('DELETE /users/me/identities/google', () => {
  it('refuses with 409 LAST_SIGNIN_METHOD for a Google-only user', async () => {
    const { userId, token } = await makeUser('gonly', { google: true });
    expectLastMethod409(await del('/users/me/identities/google', token));
    expect(await googleRows(userId)).toHaveLength(1);
  });

  it('refuses when Discord is only an unlinked: placeholder', async () => {
    const { userId, token } = await makeUser('gunl', {
      google: true,
      discordId: 'unlinked:123123123',
    });
    expectLastMethod409(await del('/users/me/identities/google', token));
    expect(await googleRows(userId)).toHaveLength(1);
  });

  it('unlinks when a password remains', async () => {
    const { userId, token } = await makeUser('gpw', {
      google: true,
      password: true,
    });
    const res = await del('/users/me/identities/google', token);
    expect(res.status).toBe(204);
    expect(await googleRows(userId)).toHaveLength(0);
  });

  it('unlinks when a real Discord id remains', async () => {
    const { userId, token } = await makeUser('gdc', {
      google: true,
      discordId: '200300400',
    });
    expect((await del('/users/me/identities/google', token)).status).toBe(204);
    expect(await googleRows(userId)).toHaveLength(0);
  });

  it('is a 204 no-op when no Google identity is linked', async () => {
    const { token } = await makeUser('nog', { discordId: '200300401' });
    expect((await del('/users/me/identities/google', token)).status).toBe(204);
  });
});

describe('DELETE /users/me/discord', () => {
  it('unlinks when Google remains', async () => {
    const { userId, token } = await makeUser('dg', {
      google: true,
      discordId: '300400500',
    });
    expect((await del('/users/me/discord', token)).status).toBe(204);
    expect(await discordIdOf(userId)).toBe('unlinked:300400500');
    expect(await googleRows(userId)).toHaveLength(1);
  });

  it('refuses a Discord-only user: Discord is their last method (ruling 10)', async () => {
    const { userId, token } = await makeUser('donly', {
      discordId: '300400501',
    });
    const res = await del('/users/me/discord', token);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'LAST_SIGNIN_METHOD' });
    expect(await discordIdOf(userId)).toBe('300400501');
  });
});

describe('concurrent unlinks (review M1)', () => {
  it('Discord + Google unlinked at once: exactly one wins, a method remains', async () => {
    const { userId, token } = await makeUser('race', {
      google: true,
      discordId: '300400502',
    });
    const [g, d] = await Promise.all([
      del('/users/me/identities/google', token),
      del('/users/me/discord', token),
    ]);
    expect([g.status, d.status].sort()).toEqual([204, 409]);
    const loser = g.status === 409 ? g : d;
    expectLastMethod409(loser);
    const google = (await googleRows(userId)).length;
    const discord = await discordIdOf(userId);
    const remaining = google + (discord === '300400502' ? 1 : 0);
    expect({ google, discord, remaining }).toMatchObject({ remaining: 1 });
  });
});

describe('GET /auth/me signinMethods', () => {
  it('reports every method the owner has, contract-valid', async () => {
    const { token } = await makeUser('all3', {
      google: true,
      password: true,
      discordId: '400500600',
    });
    const res = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const methods: unknown = res.body.signinMethods;
    expect(methods).toEqual({
      discord: true,
      google: { email: GOOGLE_EMAIL, linkedAt: expect.any(String) },
      password: true,
    });
    expect(() => SigninMethodsSchema.parse(methods)).not.toThrow();
  });

  it('a placeholder Discord id and no other rows → all false/null', async () => {
    const { token } = await makeUser('none', { discordId: 'local:x@y.z' });
    const res = await testApp.request
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.signinMethods).toEqual({
      discord: false,
      google: null,
      password: false,
    });
  });
});

function adminPut(body: object) {
  return testApp.request
    .put(ADMIN_ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body);
}

async function adminSigninEnabled(): Promise<unknown> {
  const res = await testApp.request
    .get(ADMIN_ROUTE)
    .set('Authorization', `Bearer ${adminToken}`);
  return res.body.googleSigninEnabled;
}

describe('admin "Allow sign-in with Google" toggle', () => {
  it('reads false when the setting is absent', async () => {
    expect(await adminSigninEnabled()).toBe(false);
  });

  it('enabling with no Google client → 400, nothing stored', async () => {
    const res = await adminPut({ googleSigninEnabled: true });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Set the Google client first');
    expect(await adminSigninEnabled()).toBe(false);
  });

  it('enabling with only a client id → 400', async () => {
    const res = await adminPut({
      google: { clientId: 'id.apps.googleusercontent.com' },
      googleSigninEnabled: true,
    });
    expect(res.status).toBe(400);
    expect(await adminSigninEnabled()).toBe(false);
  });

  it('round-trips once the client is set (same PUT or stored)', async () => {
    const on = await adminPut({
      google: { clientId: 'id.apps.googleusercontent.com', clientSecret: 's' },
      googleSigninEnabled: true,
    });
    expect(on.status).toBe(200);
    expect(on.body.googleSigninEnabled).toBe(true);
    expect((await adminPut({ googleSigninEnabled: false })).status).toBe(200);
    expect(await adminSigninEnabled()).toBe(false);
    expect((await adminPut({ googleSigninEnabled: true })).status).toBe(200);
    expect(await adminSigninEnabled()).toBe(true);
  });
});

describe('deleting a user removes their identities (AC 9)', () => {
  it('self-delete leaves no user_auth_identities row', async () => {
    const { userId, token } = await makeUser('leaver', {
      google: true,
      discordId: '500600700',
    });
    const res = await testApp.request
      .delete('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ confirmName: 'leaver' });
    expect(res.status).toBe(204);
    expect(await googleRows(userId)).toHaveLength(0);
  });
});
