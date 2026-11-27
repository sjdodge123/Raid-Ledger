/**
 * ROK-2371 D1(a): the two ways a PARKED DISCORD identity is completed
 * (review M2), against Postgres + the app Redis mock.
 *
 *  (a) "I already have an account" → Google pending-link
 *      (`GET /auth/google?intent=pending-link` → `/auth/google/callback`):
 *      happy path, banned / deactivated refusal, `already_linked`, `taken`,
 *      `not_found`, `expired`.
 *  (b) "Create a new account" → `POST /auth/first-time/create`: today's
 *      Discord create (`validateDiscordUser`), the fleet first-login promotion
 *      and a `discord` session.
 *
 * Google is the `googleHttp.googleFormPost` spy; the record is parked straight
 * into Redis exactly as the Discord callback writes it.
 */
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { stubGoogle } from '../../calendar-sync/calendar-oauth.integration.spec-helpers';
import {
  FLEET_ADMIN_ID_ENV,
  FLEET_FIRST_LOGIN_ENV,
} from '../fleet-first-login-admin.helpers';
import {
  configureGoogleSignin,
  FIRST_TIME_CREATE,
  insertUser,
  landCallback,
  linkGoogleIdentity,
  must,
  REFRESH_COOKIE,
  refreshRowsOf,
  startSignin,
  tokenWith,
  userCount,
} from './google-signin.integration.spec-helpers';
import { PENDING_IDENTITY_COOKIE } from './pending-identity.store';

const SUB = '333333333333333333333';
const SNOWFLAKE = '400000000000000001';
const ENV_KEYS = ['DEMO_MODE', FLEET_FIRST_LOGIN_ENV, FLEET_ADMIN_ID_ENV];

let testApp: TestApp;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  testApp = await getTestApp();
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

beforeEach(async () => {
  await configureGoogleSignin(testApp, true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  testApp.seed = await truncateAllTables(testApp.db);
});

interface Parked {
  cookie: string;
  key: string;
}

/** Park a Discord identity the way the Discord callback does. */
async function parkDiscord(
  extra: Record<string, unknown> = {},
): Promise<Parked> {
  const secret = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(secret).digest('hex');
  const key = `pending-identity:${hash}`;
  const record = {
    provider: 'discord',
    subject: SNOWFLAKE,
    displayName: 'Parked Raider',
    email: null,
    avatar: 'avatarhash',
    ...extra,
  };
  await testApp.redisMock.client.set(key, JSON.stringify(record), 'EX', 600);
  return { cookie: `${PENDING_IDENTITY_COOKIE}=${secret}`, key };
}

/** The pending-link hop: start in this browser, stub Google, land. */
async function pendingLink(parked: Parked, beforeLand?: () => Promise<void>) {
  const started = await startSignin(
    testApp,
    { intent: 'pending-link' },
    parked.cookie,
  );
  stubGoogle(
    tokenWith({
      nonce: started.nonce,
      sub: SUB,
      email: 'owner@example.test',
      email_verified: true,
    }),
  );
  if (beforeLand) await beforeLand();
  return landCallback(
    testApp,
    { code: 'auth-code-pl', state: started.state },
    `${started.cookie}; ${parked.cookie}`,
  );
}

async function discordIdOf(userId: number): Promise<string | null> {
  const [row] = await testApp.db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return must(row, `user ${userId}`).discordId;
}

async function googleOwner(label: string, extra = {}) {
  const user = await insertUser(testApp, { username: label, ...extra });
  await linkGoogleIdentity(testApp, user.id, SUB, 'owner@example.test');
  return user;
}

describe('Google pending-link for a parked Discord identity (M2a)', () => {
  it('links the snowflake to the account Google finds and signs in', async () => {
    const owner = await googleOwner('pl-owner');
    const parked = await parkDiscord();
    const { location, cookies } = await pendingLink(parked);
    expect(location.pathname).toBe('/auth/success');
    expect(location.searchParams.get('via')).toBe('google');
    expect(cookies.has(REFRESH_COOKIE)).toBe(true);
    expect(await discordIdOf(owner.id)).toBe(SNOWFLAKE);
    expect(await testApp.redisMock.client.get(parked.key)).toBeNull();
  });

  it.each([
    ['banned', { bannedAt: new Date() }, 'suspended'],
    ['deactivated', { deactivatedAt: new Date() }, 'deactivated'],
  ] as const)(
    'refuses a %s found account and links nothing',
    async (label, extra, error) => {
      const owner = await googleOwner(`pl-${label}`, extra);
      const { location, cookies } = await pendingLink(await parkDiscord());
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('error')).toBe(error);
      expect(cookies.has(REFRESH_COOKIE)).toBe(false);
      expect(await discordIdOf(owner.id)).toBeNull();
    },
  );

  it('already_linked: the found account has a different Discord', async () => {
    const owner = await googleOwner('pl-has-discord', {
      discordId: '400000000000000999',
    });
    const parked = await parkDiscord();
    const { location } = await pendingLink(parked);
    expect(location.pathname).toBe('/auth/first-time');
    expect(location.searchParams.get('error')).toBe('already_linked');
    expect(await discordIdOf(owner.id)).toBe('400000000000000999');
    expect(await testApp.redisMock.client.get(parked.key)).not.toBeNull();
  });

  it('taken: the snowflake already belongs to another account', async () => {
    const owner = await googleOwner('pl-target');
    const other = await insertUser(testApp, {
      username: 'pl-other',
      discordId: SNOWFLAKE,
    });
    const { location, cookies } = await pendingLink(await parkDiscord());
    expect(location.pathname).toBe('/auth/first-time');
    expect(location.searchParams.get('error')).toBe('taken');
    expect(cookies.has(REFRESH_COOKIE)).toBe(false);
    expect(await discordIdOf(owner.id)).toBeNull();
    expect(await discordIdOf(other.id)).toBe(SNOWFLAKE);
  });

  it('not_found: Google finds nobody, the parked record is kept', async () => {
    const before = await userCount(testApp);
    const parked = await parkDiscord();
    const { location } = await pendingLink(parked);
    expect(location.pathname).toBe('/auth/first-time');
    expect(location.searchParams.get('error')).toBe('not_found');
    expect(await userCount(testApp)).toBe(before);
    expect(await testApp.redisMock.client.get(parked.key)).not.toBeNull();
  });

  it('expired: the parked record lapsed between start and callback', async () => {
    const owner = await googleOwner('pl-expired');
    const parked = await parkDiscord();
    const { location } = await pendingLink(parked, async () => {
      await testApp.redisMock.client.del(parked.key);
    });
    expect(location.pathname).toBe('/auth/first-time');
    expect(location.searchParams.get('error')).toBe('expired');
    expect(await discordIdOf(owner.id)).toBeNull();
  });
});

function create(cookie: string) {
  return testApp.request.post(FIRST_TIME_CREATE).set('Cookie', cookie).send({});
}

async function userBySnowflake() {
  const [row] = await testApp.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, SNOWFLAKE));
  return row ?? null;
}

describe('POST /auth/first-time/create for a parked Discord identity (M2b)', () => {
  it('creates the Discord user exactly as today and issues a discord session', async () => {
    const before = await userCount(testApp);
    const parked = await parkDiscord();
    const res = await create(parked.cookie);
    expect(res.status).toBe(200);
    const redirect = new URL(String(res.body.redirect), 'http://rl.test');
    expect(redirect.pathname).toBe('/auth/success');
    expect(redirect.searchParams.get('via')).toBe('discord');
    expect(redirect.searchParams.get('code')).toMatch(/^[0-9a-f]{64}$/);
    expect(String(res.headers['set-cookie'])).toContain(`${REFRESH_COOKIE}=`);
    const user = must(await userBySnowflake(), 'created Discord user');
    expect(user.username).toBe('Parked Raider');
    expect(user.avatar).toBe('avatarhash');
    expect(user.role).toBe('member');
    expect(await userCount(testApp)).toBe(before + 1);
    const rows = await refreshRowsOf(testApp, user.id);
    expect(rows.map((r) => r.authMethod)).toEqual(['discord']);
    expect(await testApp.redisMock.client.get(parked.key)).toBeNull();
    expect((await create(parked.cookie)).status).toBe(404);
  });

  it('runs the fleet first-login promotion on the created Discord user', async () => {
    process.env.DEMO_MODE = 'true';
    process.env[FLEET_FIRST_LOGIN_ENV] = 'true';
    delete process.env[FLEET_ADMIN_ID_ENV];
    const res = await create((await parkDiscord()).cookie);
    expect(res.status).toBe(200);
    const user = must(await userBySnowflake(), 'created Discord user');
    expect(user.role).toBe('admin');
  });
});
