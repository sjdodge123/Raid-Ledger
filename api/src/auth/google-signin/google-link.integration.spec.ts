/**
 * ROK-2371 §3 "Linking Google from Profile" + AC 6, against Postgres.
 * Google is the calendar spec's `googleHttp.googleFormPost` spy; the start
 * nonce, its `rl_link_google` cookie, the signed `link` state, the
 * `rl_link_state_google` binding, the seed and the identity insert are real.
 */
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { getTestApp, type TestApp } from '../../common/testing/test-app';
import { truncateAllTables } from '../../common/testing/integration-helpers';
import { signTestAccessToken } from '../../common/testing/sign-test-access-token';
import {
  formsSentTo,
  stubGoogle,
} from '../../calendar-sync/calendar-oauth.integration.spec-helpers';
import { GOOGLE_TOKEN_URL } from '../../calendar-sync/providers/google/google-oauth.helpers';
import { LINK_REQUEST_EXPIRED_MESSAGE } from '../link-nonce.service';
import { GOOGLE_SUB_TAKEN_MESSAGE } from './google-signin.service';
import { UNLINK_CURRENT_GOOGLE_MESSAGE } from './google-link.service';
import {
  configureGoogleSignin,
  identitiesOf,
  insertUser,
  linkGoogleIdentity,
  must,
  setCookies,
  tokenWith,
} from './google-signin.integration.spec-helpers';

const START = '/auth/google/link/start';
const HOP = '/auth/google/link';
const CALLBACK = '/auth/google/link/callback';
const NONCE_COOKIE = 'rl_link_google';
const STATE_COOKIE = 'rl_link_state_google';
const SUB = '204060801234567890123';

let testApp: TestApp;
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await configureGoogleSignin(testApp, true);
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

async function member(): Promise<{ id: number; token: string }> {
  seq += 1;
  const username = `glink-${seq}`;
  const user = await insertUser(testApp, { username });
  const token = await signTestAccessToken(testApp, {
    sub: user.id,
    username,
    role: 'member',
  });
  return { id: user.id, token };
}

/** POST start → the nonce + this browser's `rl_link_google` cookie. */
async function startLink(token: string) {
  const res = await testApp.request
    .post(START)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(200);
  const body = res.body as { nonce: string; expiresIn: number };
  return {
    nonce: body.nonce,
    cookie: must(setCookies(res).get(NONCE_COOKIE), 'nonce cookie'),
  };
}

function hop(nonce: string, cookie?: string) {
  const req = testApp.request.get(HOP).query({ nonce });
  return cookie ? req.set('Cookie', cookie) : req;
}

/** start → hop: the signed state, the OIDC nonce and the state cookie. */
async function toGoogle(token: string) {
  const started = await startLink(token);
  const res = await hop(started.nonce, started.cookie);
  expect(res.status).toBe(302);
  const url = new URL(String(res.headers.location));
  expect(url.host).toBe('accounts.google.com');
  return {
    state: must(url.searchParams.get('state'), 'state'),
    oidcNonce: must(url.searchParams.get('nonce'), 'oidc nonce'),
    cookie: must(setCookies(res).get(STATE_COOKIE), 'state cookie'),
  };
}

async function land(query: Record<string, string>, cookie?: string) {
  const req = testApp.request.get(CALLBACK).query(query);
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  expect(res.status).toBe(302);
  const loc = new URL(String(res.headers.location));
  return {
    path: loc.pathname,
    linked: loc.searchParams.get('linked'),
    provider: loc.searchParams.get('provider'),
    message: loc.searchParams.get('message'),
  };
}

function stubFor(oidcNonce: string, claims: Record<string, unknown> = {}) {
  return stubGoogle(
    tokenWith({
      sub: SUB,
      email: 'glink@example.test',
      email_verified: true,
      nonce: oidcNonce,
      ...claims,
    }),
  );
}

async function googleSubsOf(userId: number): Promise<string[]> {
  return (await identitiesOf(testApp, userId))
    .filter((r) => r.provider === 'google')
    .map((r) => r.subject);
}

describe('Google link from Profile (ROK-2371 §3, AC 6)', () => {
  it('links the Google sub to the signed-in user and lands on integrations', async () => {
    const me = await member();
    const g = await toGoogle(me.token);
    const spy = stubFor(g.oidcNonce);
    const out = await land({ code: 'c1', state: g.state }, g.cookie);
    expect(out).toEqual({
      path: '/profile/integrations',
      linked: 'success',
      provider: 'google',
      message: null,
    });
    expect(await googleSubsOf(me.id)).toEqual([SUB]);
    const forms = formsSentTo(spy, GOOGLE_TOKEN_URL);
    expect(forms).toHaveLength(1);
    expect(forms[0]?.redirect_uri).toMatch(
      /\/api\/auth\/google\/link\/callback$/,
    );
  });

  it('409s when the sub is linked to another user', async () => {
    const other = await member();
    await linkGoogleIdentity(testApp, other.id, SUB, 'x@example.test');
    const me = await member();
    const g = await toGoogle(me.token);
    stubFor(g.oidcNonce);
    const out = await land({ code: 'c1', state: g.state }, g.cookie);
    expect(out.linked).toBe('error');
    expect(out.message).toBe(GOOGLE_SUB_TAKEN_MESSAGE);
    expect(await googleSubsOf(me.id)).toEqual([]);
    expect(await googleSubsOf(other.id)).toEqual([SUB]);
  });

  it('409s when the user already holds a different Google account', async () => {
    const me = await member();
    await linkGoogleIdentity(testApp, me.id, 'sub-old', 'old@example.test');
    const g = await toGoogle(me.token);
    stubFor(g.oidcNonce);
    const out = await land({ code: 'c1', state: g.state }, g.cookie);
    expect(out.linked).toBe('error');
    expect(out.message).toBe(UNLINK_CURRENT_GOOGLE_MESSAGE);
    expect(await googleSubsOf(me.id)).toEqual(['sub-old']);
  });

  it('relinking the same sub is idempotent', async () => {
    const me = await member();
    await linkGoogleIdentity(testApp, me.id, SUB, 'glink@example.test');
    const g = await toGoogle(me.token);
    stubFor(g.oidcNonce);
    const out = await land({ code: 'c1', state: g.state }, g.cookie);
    expect(out.linked).toBe('success');
    expect(await googleSubsOf(me.id)).toEqual([SUB]);
  });

  it('refuses an unverified Google email without linking', async () => {
    const me = await member();
    const g = await toGoogle(me.token);
    stubFor(g.oidcNonce, { email_verified: false });
    const out = await land({ code: 'c1', state: g.state }, g.cookie);
    expect(out.linked).toBe('error');
    expect(await googleSubsOf(me.id)).toEqual([]);
  });
});

describe('Google link — rejected before the code exchange (AC 6)', () => {
  it('a tampered state never reaches Google', async () => {
    const me = await member();
    const g = await toGoogle(me.token);
    const spy = stubFor(g.oidcNonce);
    const [head, body, sig] = g.state.split('.');
    const mid = Math.floor(must(body, 'payload').length / 2);
    const flip = body?.[mid] === 'A' ? 'B' : 'A';
    const tampered = `${head}.${body?.slice(0, mid)}${flip}${body?.slice(mid + 1)}.${sig}`;
    const out = await land({ code: 'c1', state: tampered }, g.cookie);
    expect(out.message).toBe(LINK_REQUEST_EXPIRED_MESSAGE);
    expect(spy).not.toHaveBeenCalled();
    expect(await googleSubsOf(me.id)).toEqual([]);
  });

  it('a state arriving without its browser cookie never reaches Google', async () => {
    const me = await member();
    const g = await toGoogle(me.token);
    const spy = stubFor(g.oidcNonce);
    const out = await land({ code: 'c1', state: g.state });
    expect(out.message).toBe(LINK_REQUEST_EXPIRED_MESSAGE);
    expect(spy).not.toHaveBeenCalled();
    expect(await googleSubsOf(me.id)).toEqual([]);
  });

  it('a replayed callback exchanges at most once', async () => {
    const me = await member();
    const g = await toGoogle(me.token);
    const spy = stubFor(g.oidcNonce);
    await land({ code: 'c1', state: g.state }, g.cookie);
    const again = await land({ code: 'c2', state: g.state }, g.cookie);
    expect(again.message).toBe(LINK_REQUEST_EXPIRED_MESSAGE);
    expect(formsSentTo(spy, GOOGLE_TOKEN_URL)).toHaveLength(1);
  });
});

describe('Google link — account re-checked at consume time (spec §8)', () => {
  it.each([
    ['banned', { bannedAt: new Date(), banReason: 'Spamming' }],
    ['deactivated', { deactivatedAt: new Date() }],
    ['kicked in cooldown', { kickedAt: new Date() }],
  ] as const)(
    'a user %s after /link/start is refused before the exchange',
    async (_label, status) => {
      const me = await member();
      const g = await toGoogle(me.token);
      const spy = stubFor(g.oidcNonce);
      await testApp.db
        .update(schema.users)
        .set(status)
        .where(eq(schema.users.id, me.id));
      const out = await land({ code: 'c1', state: g.state }, g.cookie);
      expect(out.linked).toBe('error');
      expect(out.message).toEqual(expect.any(String));
      expect(spy).not.toHaveBeenCalled();
      expect(await googleSubsOf(me.id)).toEqual([]);
    },
  );
});

describe('Google link — start nonce and toggle', () => {
  it('the start nonce is single-use', async () => {
    const me = await member();
    const started = await startLink(me.token);
    expect((await hop(started.nonce, started.cookie)).status).toBe(302);
    const second = await hop(started.nonce, started.cookie);
    const loc = new URL(String(second.headers.location));
    expect(loc.host).not.toBe('accounts.google.com');
    expect(loc.searchParams.get('message')).toBe(LINK_REQUEST_EXPIRED_MESSAGE);
  });

  it('the nonce is refused without the minting browser cookie', async () => {
    const me = await member();
    const started = await startLink(me.token);
    const res = await hop(started.nonce);
    const loc = new URL(String(res.headers.location));
    expect(loc.pathname).toBe('/profile/integrations');
    expect(loc.searchParams.get('linked')).toBe('error');
  });

  it('start needs a session and an empty body', async () => {
    expect((await testApp.request.post(START).send({})).status).toBe(401);
    const me = await member();
    const res = await testApp.request
      .post(START)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ token: 'x' });
    expect(res.status).toBe(400);
  });

  it('every link route 404s while the toggle is off', async () => {
    const me = await member();
    await configureGoogleSignin(testApp, false);
    const start = await testApp.request
      .post(START)
      .set('Authorization', `Bearer ${me.token}`)
      .send({});
    expect(start.status).toBe(404);
    expect((await testApp.request.get(HOP).query({ nonce: 'n' })).status).toBe(
      404,
    );
    expect((await testApp.request.get(CALLBACK)).status).toBe(404);
  });
});
