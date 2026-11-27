/**
 * ROK-2371 D1(a), Discord side (integration, real DB, app Redis mock).
 *
 * Drives the REAL passport pipeline — `GET /auth/discord` (or
 * `/auth/discord/pending-link`) mints a browser-bound state, then
 * `/auth/discord/callback` verifies it — with only Discord's HTTP edges
 * stubbed (token exchange, profile fetch). Google sign-in is toggled by
 * stubbing `GoogleSigninService.isEnabled` on the app instance.
 *
 *  - toggle off + unknown snowflake → a user is created, exactly as today
 *  - toggle on  + unknown snowflake → parked, `/auth/first-time`, no user
 *  - pending-link + found user      → the parked Google identity is linked
 *  - pending-link + banned/deactivated found user → refused, nothing linked
 *  - pending-link + nobody found    → back to the choice, no user, record kept
 */
import * as crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { OAuth2 } from 'oauth';
import { Strategy as DiscordPassportStrategy } from 'passport-discord';
import { ConfigService } from '@nestjs/config';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import * as schema from '../../drizzle/schema';
import { DiscordAuthStrategy } from '../../plugins/discord/discord-auth.strategy';
import { SettingsService } from '../../settings/settings.service';
import { GoogleSigninService } from './google-signin.service';
import { PENDING_IDENTITY_COOKIE } from './pending-identity.store';

const DISCORD_OAUTH = {
  clientId: 'd1a-client-id',
  clientSecret: 'd1a-client-secret',
  callbackUrl: 'http://localhost:3000/auth/discord/callback',
};
const GOOGLE_SUB = 'google-sub-d1a';

type TokenCallback = (err: null, at: string, rt: string, p: object) => void;
function isTokenCallback(v: unknown): v is TokenCallback {
  return typeof v === 'function';
}

let testApp: TestApp;
let profileId = 'snowflake-unset';

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  jest
    .spyOn(testApp.app.get(SettingsService), 'getDiscordOAuthConfig')
    .mockResolvedValue(DISCORD_OAUTH);
  await testApp.app.get(DiscordAuthStrategy).reloadConfig();
  jest
    .spyOn(OAuth2.prototype, 'getOAuthAccessToken')
    .mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1];
      if (isTokenCallback(cb)) cb(null, 'at', 'rt', {});
    });
  jest
    .spyOn(DiscordPassportStrategy.prototype, 'userProfile')
    .mockImplementation((_t, done) =>
      done(null, { id: profileId, username: 'D1a Tester', avatar: null }),
    );
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

// ── helpers ──────────────────────────────────────────────────────────────────

function clientUrl(): string {
  const url = testApp.app.get(ConfigService).get<string>('CLIENT_URL');
  if (!url) throw new Error('CLIENT_URL unset in the test app');
  return url;
}

function googleEnabled(on: boolean): void {
  jest
    .spyOn(testApp.app.get(GoogleSigninService), 'isEnabled')
    .mockResolvedValue(on);
}

/** `name=value` pairs from a response's Set-Cookie, joined for a request. */
function cookiesOf(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return list
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.split(';')[0] ?? '');
}

/** Start a login hop; returns its state and the cookies it set. */
async function start(path: string, cookies: string[] = []) {
  const res = await testApp.request.get(path).set('Cookie', cookies);
  expect(res.status).toBe(302);
  const state = new URL(res.headers.location ?? '').searchParams.get('state');
  if (!state) throw new Error(`no state on ${res.headers.location}`);
  return { state, cookies: [...cookies, ...cookiesOf(res)] };
}

async function callback(flow: { state: string; cookies: string[] }) {
  return testApp.request
    .get('/auth/discord/callback')
    .query({ code: 'discord-code', state: flow.state })
    .set('Cookie', flow.cookies);
}

/** Park a Google identity the way the Google callback does; its cookie. */
async function parkGoogle(): Promise<{ cookie: string; key: string }> {
  const secret = crypto.randomBytes(32).toString('base64url');
  const key = `pending-identity:${crypto.createHash('sha256').update(secret).digest('hex')}`;
  const record = {
    provider: 'google',
    subject: GOOGLE_SUB,
    displayName: 'Google Person',
    email: 'person@example.test',
    avatar: null,
  };
  await testApp.redisMock.client.set(key, JSON.stringify(record), 'EX', 600);
  return { cookie: `${PENDING_IDENTITY_COOKIE}=${secret}`, key };
}

async function seedDiscordUser(
  discordId: string,
  extra: Partial<typeof schema.users.$inferInsert> = {},
): Promise<number> {
  const [u] = await testApp.db
    .insert(schema.users)
    .values({ username: `u-${discordId}`, discordId, ...extra })
    .returning({ id: schema.users.id });
  if (!u) throw new Error('seed user failed');
  return u.id;
}

async function userByDiscordId(discordId: string) {
  const [u] = await testApp.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId));
  return u ?? null;
}

async function googleIdentities() {
  return testApp.db
    .select({ userId: schema.userAuthIdentities.userId })
    .from(schema.userAuthIdentities)
    .where(
      and(
        eq(schema.userAuthIdentities.provider, 'google'),
        eq(schema.userAuthIdentities.subject, GOOGLE_SUB),
      ),
    );
}

// ── unknown snowflake ────────────────────────────────────────────────────────

describe('Discord sign-in with an unknown snowflake', () => {
  it('creates the user exactly as today while Google sign-in is off', async () => {
    googleEnabled(false);
    profileId = 'snowflake-new-off';
    const res = await callback(await start('/auth/discord'));
    expect(res.headers.location).toMatch(
      new RegExp(`^${clientUrl()}/auth/success\\?code=`),
    );
    expect(await userByDiscordId(profileId)).not.toBeNull();
    expect(cookiesOf(res).join(';')).not.toContain(PENDING_IDENTITY_COOKIE);
  });

  it('parks the identity and sends the browser to /auth/first-time while Google sign-in is on', async () => {
    googleEnabled(true);
    profileId = 'snowflake-new-on';
    const res = await callback(await start('/auth/discord'));
    expect(res.headers.location).toBe(`${clientUrl()}/auth/first-time`);
    expect(await userByDiscordId(profileId)).toBeNull();
    const pending = cookiesOf(res).filter((c) =>
      c.startsWith(`${PENDING_IDENTITY_COOKIE}=`),
    );
    expect(pending).toHaveLength(1);
    const view = await testApp.request
      .get('/auth/first-time')
      .set('Cookie', pending);
    expect(view.status).toBe(200);
    expect(view.body).toEqual({
      provider: 'discord',
      displayName: 'D1a Tester',
      otherMethod: 'google',
    });
  });

  it('keeps a PUG invite through the park and re-applies it on create (review m6)', async () => {
    googleEnabled(true);
    profileId = 'snowflake-new-invite';
    const res = await callback(
      await start('/auth/discord/invite?code=PUGCODE1'),
    );
    expect(res.headers.location).toBe(
      `${clientUrl()}/auth/first-time?invite=PUGCODE1`,
    );
    const pending = cookiesOf(res).filter((c) =>
      c.startsWith(`${PENDING_IDENTITY_COOKIE}=`),
    );
    const created = await testApp.request
      .post('/auth/first-time/create')
      .set('Cookie', pending)
      .send({});
    expect(created.status).toBe(200);
    expect(String(created.body.redirect)).toMatch(
      /^\/auth\/success\?code=[0-9a-f]{64}&via=discord&invite=PUGCODE1$/,
    );
    expect(await userByDiscordId(profileId)).not.toBeNull();
  });

  it('still signs a known Discord user straight in while Google sign-in is on', async () => {
    googleEnabled(true);
    profileId = 'snowflake-known-on';
    await seedDiscordUser(profileId);
    const res = await callback(await start('/auth/discord'));
    expect(res.headers.location).toMatch(
      new RegExp(`^${clientUrl()}/auth/success\\?code=`),
    );
  });
});

// ── pending-link (parked Google identity, "I already have an account") ───────

describe('Discord pending-link for a parked Google identity', () => {
  it('links the Google identity to the account Discord finds and signs in', async () => {
    googleEnabled(true);
    profileId = 'snowflake-owner';
    const userId = await seedDiscordUser(profileId);
    const parked = await parkGoogle();
    const flow = await start('/auth/discord/pending-link', [parked.cookie]);
    const res = await callback(flow);
    expect(res.headers.location).toMatch(
      new RegExp(`^${clientUrl()}/auth/success\\?code=.+&via=discord$`),
    );
    expect(await googleIdentities()).toEqual([{ userId }]);
    expect(await testApp.redisMock.client.get(parked.key)).toBeNull();
  });

  it.each([
    ['banned', { bannedAt: new Date() }, '/login?error=suspended'],
    ['deactivated', { deactivatedAt: new Date() }, '/login?error=deactivated'],
  ] as const)(
    'refuses a %s found user and links nothing',
    async (_label, extra, landing) => {
      googleEnabled(true);
      profileId = `snowflake-${_label}`;
      await seedDiscordUser(profileId, extra);
      const parked = await parkGoogle();
      const flow = await start('/auth/discord/pending-link', [parked.cookie]);
      const res = await callback(flow);
      expect(res.headers.location).toContain(landing);
      expect(await googleIdentities()).toEqual([]);
    },
  );

  it('sends the browser back to the choice when Discord finds nobody either', async () => {
    googleEnabled(true);
    profileId = 'snowflake-nobody';
    const parked = await parkGoogle();
    const flow = await start('/auth/discord/pending-link', [parked.cookie]);
    const res = await callback(flow);
    expect(res.headers.location).toBe(
      `${clientUrl()}/auth/first-time?error=not_found`,
    );
    expect(await userByDiscordId(profileId)).toBeNull();
    expect(await googleIdentities()).toEqual([]);
    expect(await testApp.redisMock.client.get(parked.key)).not.toBeNull();
    expect(cookiesOf(res).join(';')).not.toContain(PENDING_IDENTITY_COOKIE);
  });

  it('refuses to start without a parked Google identity in this browser', async () => {
    googleEnabled(true);
    const res = await testApp.request.get('/auth/discord/pending-link');
    expect(res.headers.location).toBe(
      `${clientUrl()}/auth/first-time?error=expired`,
    );
  });
});
