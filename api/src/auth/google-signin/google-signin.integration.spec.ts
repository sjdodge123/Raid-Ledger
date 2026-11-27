/**
 * ROK-2371 — Sign in with Google against Postgres + Redis (spec §9 AC 1, 3,
 * 4, 5 and the sign-in half of 6; §10).
 *
 * Google is a `googleHttp.googleFormPost` spy; everything else is real: the
 * toggle, the signed state, the browser-binding cookie, the single-use seed,
 * the nonce check, the D1a pending identity and the session issue.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import {
  formsSentTo,
  stubGoogle,
} from '../../calendar-sync/calendar-oauth.integration.spec-helpers';
import { GOOGLE_TOKEN_URL } from '../../calendar-sync/providers/google/google-oauth.helpers';
import {
  configureGoogleSignin,
  FIRST_TIME,
  FIRST_TIME_CREATE,
  identitiesForSub,
  identitiesOf,
  insertUser,
  landCallback,
  linkGoogleIdentity,
  must,
  PENDING_COOKIE,
  REFRESH_COOKIE,
  refreshRowsOf,
  s256,
  SIGNIN_CALLBACK,
  SIGNIN_START,
  startSignin,
  tokenWith,
  userCount,
} from './google-signin.integration.spec-helpers';

/** Spec §3, ruling 2. */
const DEACTIVATED_COPY =
  'Your account was deactivated when you left the Discord server. Rejoin it, then sign in with Discord.';

const KNOWN_SUB = '111111111111111111111';
const NEW_SUB = '222222222222222222222';
const SHARED_EMAIL = 'same-person@example.test';

let testApp: TestApp;

beforeAll(async () => {
  testApp = await getTestApp();
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

/** Start in a fresh "browser", stub Google with `claims`, land the callback. */
async function signInWith(claims: Record<string, unknown>) {
  const started = await startSignin(testApp);
  const spy = stubGoogle(tokenWith({ nonce: started.nonce, ...claims }));
  const landed = await landCallback(
    testApp,
    { code: 'auth-code-1', state: started.state },
    started.cookie,
  );
  return { started, spy, ...landed };
}

function viewWith(cookie: string) {
  return testApp.request.get(FIRST_TIME).set('Cookie', cookie);
}

function createWith(cookie: string) {
  return testApp.request.post(FIRST_TIME_CREATE).set('Cookie', cookie);
}

describe('toggle off (AC1)', () => {
  beforeEach(async () => {
    await configureGoogleSignin(testApp, false);
  });

  it('404s every /auth/google* route even with a client configured', async () => {
    const spy = stubGoogle(tokenWith({}));
    const startRes = await testApp.request.get(SIGNIN_START);
    const pendingRes = await testApp.request
      .get(SIGNIN_START)
      .query({ intent: 'pending-link' });
    const callbackRes = await testApp.request
      .get(SIGNIN_CALLBACK)
      .query({ code: 'auth-code-1', state: 'anything' });
    expect(startRes.status).toBe(404);
    expect(pendingRes.status).toBe(404);
    expect(callbackRes.status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it('404s POST /auth/first-time/create', async () => {
    const res = await testApp.request.post(FIRST_TIME_CREATE).send({});
    expect(res.status).toBe(404);
  });
});

describe('toggle on', () => {
  beforeEach(async () => {
    await configureGoogleSignin(testApp, true);
  });

  describe('a linked Google account (AC3)', () => {
    it('signs into the same users.id with a google refresh family and via=google', async () => {
      const user = await insertUser(testApp, {
        username: 'known-raider',
        discordId: '300000000000000001',
      });
      await linkGoogleIdentity(testApp, user.id, KNOWN_SUB, SHARED_EMAIL);
      const before = await userCount(testApp);

      const { started, spy, location, cookies } = await signInWith({
        sub: KNOWN_SUB,
        email: SHARED_EMAIL,
        email_verified: true,
        given_name: 'Known',
      });

      expect(location.pathname).toBe('/auth/success');
      expect(location.searchParams.get('via')).toBe('google');
      expect(location.searchParams.get('code')).toMatch(/^[0-9a-f]{64}$/);
      expect(cookies.has(REFRESH_COOKIE)).toBe(true);
      expect(cookies.has(PENDING_COOKIE)).toBe(false);
      const rows = await refreshRowsOf(testApp, user.id);
      expect(rows.map((r) => r.authMethod)).toEqual(['google']);
      expect(await userCount(testApp)).toBe(before);
      const [identity] = await identitiesOf(testApp, user.id);
      expect(identity?.lastUsedAt).toBeInstanceOf(Date);

      const [form] = formsSentTo(spy, GOOGLE_TOKEN_URL);
      expect(form?.code).toBe('auth-code-1');
      expect(form?.redirect_uri).toMatch(/\/api\/auth\/google\/callback$/);
      expect(s256(form?.code_verifier ?? '')).toBe(started.challenge);
    });

    it('sends basic scopes only, an account chooser and S256 PKCE', async () => {
      const { url } = await startSignin(testApp);
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('prompt')).toBe('select_account');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('access_type')).toBe('online');
    });
  });

  describe('an unknown Google account (AC4)', () => {
    it.each([
      ['false', { email_verified: false }],
      ['absent', {}],
    ])(
      'is refused when email_verified is %s, with nothing created or parked',
      async (_label, verified) => {
        const before = await userCount(testApp);
        const { location, cookies } = await signInWith({
          sub: NEW_SUB,
          email: 'unverified@example.test',
          ...verified,
        });
        expect(location.pathname).toBe('/login');
        expect(location.searchParams.get('error')).toBe('google_unverified');
        expect(cookies.has(PENDING_COOKIE)).toBe(false);
        expect(cookies.has(REFRESH_COOKIE)).toBe(false);
        expect(await userCount(testApp)).toBe(before);
        expect(await identitiesForSub(testApp, NEW_SUB)).toEqual([]);
      },
    );

    it('is parked as a pending identity whose view hides the subject and email', async () => {
      const before = await userCount(testApp);
      const { location, cookies } = await signInWith({
        sub: NEW_SUB,
        email: 'newbie@example.test',
        email_verified: true,
        given_name: 'Newbie',
      });
      expect(location.pathname).toBe('/auth/first-time');
      expect(cookies.has(REFRESH_COOKIE)).toBe(false);
      const pending = must(cookies.get(PENDING_COOKIE), 'pending cookie');
      expect(await userCount(testApp)).toBe(before);

      const view = await viewWith(pending);
      expect(view.status).toBe(200);
      expect(view.body).toEqual({
        provider: 'google',
        displayName: 'Newbie',
        otherMethod: 'discord',
      });
      const text = JSON.stringify(view.body);
      expect(text).not.toContain(NEW_SUB);
      expect(text).not.toContain('newbie@example.test');
    });

    it('GET /auth/first-time 404s without the pending cookie', async () => {
      const res = await testApp.request.get(FIRST_TIME);
      expect(res.status).toBe(404);
    });

    it('POST /auth/first-time/create refuses non-JSON with 415 and keeps the record', async () => {
      const { cookies } = await signInWith({
        sub: NEW_SUB,
        email: 'newbie@example.test',
        email_verified: true,
        given_name: 'Newbie',
      });
      const pending = must(cookies.get(PENDING_COOKIE), 'pending cookie');

      const res = await createWith(pending)
        .set('Content-Type', 'text/plain')
        .send('create');
      expect(res.status).toBe(415);
      expect(await identitiesForSub(testApp, NEW_SUB)).toEqual([]);
      expect((await viewWith(pending)).status).toBe(200);
    });

    it('POST /auth/first-time/create makes a discord_id NULL user and signs in once', async () => {
      const before = await userCount(testApp);
      const { cookies } = await signInWith({
        sub: NEW_SUB,
        email: 'newbie@example.test',
        email_verified: true,
        given_name: 'Newbie',
      });
      const pending = must(cookies.get(PENDING_COOKIE), 'pending cookie');

      const res = await createWith(pending).send({});
      expect(res.status).toBe(200);
      const redirect = new URL(String(res.body.redirect), 'http://rl.test');
      expect(redirect.pathname).toBe('/auth/success');
      expect(redirect.searchParams.get('via')).toBe('google');
      expect(String(res.headers['set-cookie'])).toContain(`${REFRESH_COOKIE}=`);

      const [identity] = await identitiesForSub(testApp, NEW_SUB);
      const created = must(identity, 'created identity');
      expect(created.email).toBe('newbie@example.test');
      expect(created.lastUsedAt).toBeInstanceOf(Date);
      const [row] = await testApp.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, created.userId));
      expect(row?.discordId).toBeNull();
      expect(row?.username).toBe('Newbie');
      expect(await userCount(testApp)).toBe(before + 1);
      const rows = await refreshRowsOf(testApp, created.userId);
      expect(rows.map((r) => r.authMethod)).toEqual(['google']);

      const again = await createWith(pending).send({});
      expect(again.status).toBe(404);
      expect(await userCount(testApp)).toBe(before + 1);
    });

    it('two browsers creating the same sub at once: one 200, one 409, one account', async () => {
      const claims = {
        sub: NEW_SUB,
        email: 'racer@example.test',
        email_verified: true,
        given_name: 'Racer',
      };
      const a = must(
        (await signInWith(claims)).cookies.get(PENDING_COOKIE),
        'a',
      );
      const b = must(
        (await signInWith(claims)).cookies.get(PENDING_COOKIE),
        'b',
      );
      const before = await userCount(testApp);
      const [ra, rb] = await Promise.all([
        createWith(a).send({}),
        createWith(b).send({}),
      ]);
      expect([ra.status, rb.status].sort()).toEqual([200, 409]);
      expect(await identitiesForSub(testApp, NEW_SUB)).toHaveLength(1);
      expect(await userCount(testApp)).toBe(before + 1);
    });

    it('with the same email as an existing account never reaches that account', async () => {
      const existing = await insertUser(testApp, { username: 'email-owner' });
      await linkGoogleIdentity(testApp, existing.id, KNOWN_SUB, SHARED_EMAIL);
      const before = await userCount(testApp);

      const { location, cookies } = await signInWith({
        sub: NEW_SUB,
        email: SHARED_EMAIL,
        email_verified: true,
        given_name: 'Lookalike',
      });

      expect(location.pathname).toBe('/auth/first-time');
      expect(cookies.has(REFRESH_COOKIE)).toBe(false);
      expect(await refreshRowsOf(testApp, existing.id)).toEqual([]);
      const owned = await identitiesOf(testApp, existing.id);
      expect(owned.map((i) => i.subject)).toEqual([KNOWN_SUB]);
      expect(owned[0]?.lastUsedAt).toBeNull();
      expect(await identitiesForSub(testApp, NEW_SUB)).toEqual([]);
      expect(await userCount(testApp)).toBe(before);
    });
  });

  describe('a refused account (AC5)', () => {
    it.each([
      [
        'banned',
        { bannedAt: new Date(), banReason: 'Spamming' },
        'suspended',
        (reason: string | null) =>
          expect(reason).toBe('Your account has been suspended: Spamming'),
      ],
      [
        'kicked in cooldown',
        { kickedAt: new Date() },
        'suspended',
        (reason: string | null) =>
          expect(reason).toMatch(
            /^Your session was ended by an administrator\. You may log in again in \d+ minute\(s\)\.$/,
          ),
      ],
      [
        'deactivated',
        { deactivatedAt: new Date() },
        'deactivated',
        (reason: string | null) => expect(reason).toBe(DEACTIVATED_COPY),
      ],
    ])(
      '%s → /login refusal with the Discord-equivalent copy and no session',
      async (_label, status, error, checkReason) => {
        const user = await insertUser(testApp, {
          username: `refused-${error}`,
          discordId: '300000000000000002',
          ...status,
        });
        await linkGoogleIdentity(testApp, user.id, KNOWN_SUB, SHARED_EMAIL);

        const { location, cookies } = await signInWith({
          sub: KNOWN_SUB,
          email: SHARED_EMAIL,
          email_verified: true,
        });

        expect(location.pathname).toBe('/login');
        expect(location.searchParams.get('error')).toBe(error);
        checkReason(location.searchParams.get('reason'));
        expect(cookies.has(REFRESH_COOKIE)).toBe(false);
        expect(await refreshRowsOf(testApp, user.id)).toEqual([]);
        const [identity] = await identitiesOf(testApp, user.id);
        expect(identity?.lastUsedAt).toBeNull();
      },
    );
  });

  describe('state + browser binding (AC6, sign-in side)', () => {
    async function knownUser() {
      const user = await insertUser(testApp, { username: 'state-raider' });
      await linkGoogleIdentity(testApp, user.id, KNOWN_SUB, SHARED_EMAIL);
      return user;
    }

    function tamper(jwt: string): string {
      const parts = jwt.split('.');
      const sig = must(parts[2], 'state signature');
      const mid = Math.floor(sig.length / 2);
      const swapped = sig[mid] === 'A' ? 'B' : 'A';
      parts[2] = `${sig.slice(0, mid)}${swapped}${sig.slice(mid + 1)}`;
      return parts.join('.');
    }

    async function expectRejectedBeforeExchange(
      query: Record<string, string>,
      cookie?: string,
    ) {
      const user = await knownUser();
      const spy = stubGoogle(tokenWith({ sub: KNOWN_SUB }));
      const { location, cookies } = await landCallback(testApp, query, cookie);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('error')).toBe('oauth_failed');
      expect(spy).not.toHaveBeenCalled();
      expect(cookies.has(REFRESH_COOKIE)).toBe(false);
      expect(await refreshRowsOf(testApp, user.id)).toEqual([]);
    }

    it('rejects a tampered state before the code exchange', async () => {
      const s = await startSignin(testApp);
      await expectRejectedBeforeExchange(
        { code: 'auth-code-1', state: tamper(s.state) },
        s.cookie,
      );
    });

    it('rejects a valid state without the browser cookie before the code exchange', async () => {
      const s = await startSignin(testApp);
      await expectRejectedBeforeExchange({
        code: 'auth-code-1',
        state: s.state,
      });
    });

    it("rejects a valid state carried by another browser's cookie", async () => {
      const mine = await startSignin(testApp);
      const theirs = await startSignin(testApp);
      await expectRejectedBeforeExchange(
        { code: 'auth-code-1', state: mine.state },
        theirs.cookie,
      );
    });

    it('rejects a callback without a code before the code exchange', async () => {
      const s = await startSignin(testApp);
      await expectRejectedBeforeExchange({ state: s.state }, s.cookie);
    });

    it('spends a state once: a replay is refused without a second exchange', async () => {
      const user = await knownUser();
      const first = await signInWith({
        sub: KNOWN_SUB,
        email: SHARED_EMAIL,
        email_verified: true,
      });
      expect(first.location.pathname).toBe('/auth/success');

      const replay = await landCallback(
        testApp,
        { code: 'auth-code-1', state: first.started.state },
        first.started.cookie,
      );
      expect(replay.location.searchParams.get('error')).toBe('oauth_failed');
      expect(first.spy).toHaveBeenCalledTimes(1);
      expect(await refreshRowsOf(testApp, user.id)).toHaveLength(1);
    });
  });

  describe('id_token nonce', () => {
    it('refuses a known account whose id_token nonce does not match the state', async () => {
      const user = await insertUser(testApp, { username: 'nonce-raider' });
      await linkGoogleIdentity(testApp, user.id, KNOWN_SUB, SHARED_EMAIL);

      const { spy, location, cookies } = await signInWith({
        sub: KNOWN_SUB,
        email: SHARED_EMAIL,
        email_verified: true,
        nonce: 'not-the-state-nonce',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(location.pathname).toBe('/login');
      expect(location.searchParams.get('error')).toBe('oauth_failed');
      expect(cookies.has(REFRESH_COOKIE)).toBe(false);
      expect(await refreshRowsOf(testApp, user.id)).toEqual([]);
    });

    it('refuses an unknown verified account with a wrong nonce and parks nothing', async () => {
      const before = await userCount(testApp);
      const { location, cookies } = await signInWith({
        sub: NEW_SUB,
        email: 'newbie@example.test',
        email_verified: true,
        nonce: 'not-the-state-nonce',
      });
      expect(location.searchParams.get('error')).toBe('oauth_failed');
      expect(cookies.has(PENDING_COOKIE)).toBe(false);
      expect(await userCount(testApp)).toBe(before);
    });
  });
});
