/**
 * ROK-2022: the signed `?return=onboarding` target on the calendar OAuth
 * round-trip, against Postgres. The start route signs it into the state as
 * `t`; a callback whose state verifies lands on the first-run wizard's
 * Calendar step (`/onboarding?resume=calendar&…`) instead of My Integrations.
 * Google is a `googleHttp.googleFormPost` spy; the rest is real. The legacy
 * landing stays pinned by `calendar-oauth.integration.spec.ts`.
 */
import { Logger } from '@nestjs/common';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import { SettingsService } from '../settings/settings.service';
import { setCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';
import * as connectHelpers from './services/calendar-connect.helpers';
import {
  CALLBACK,
  enableGoogle,
  fixture,
  START,
  STATE_COOKIE,
  stubGoogle,
  type GoogleStub,
} from './calendar-oauth.integration.spec-helpers';

const sentryActual =
  jest.requireActual<typeof import('@sentry/nestjs')>('@sentry/nestjs');

let testApp: TestApp;
let user: { userId: number; token: string };
let userSeq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
});

beforeEach(async () => {
  await enableGoogle(testApp);
  userSeq += 1;
  user = await createMemberAndLogin(
    testApp,
    `cal-oauth-ret-${userSeq}`,
    `cal-oauth-ret-${userSeq}@example.test`,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  testApp.seed = await truncateAllTables(testApp.db);
});

const OK: GoogleStub = { token: { status: 200, json: fixture('token-ok') } };

/** The signed state's JSON body (base64url before the signature). */
function stateBody(state: string): Record<string, unknown> {
  const [body] = state.split('.');
  return JSON.parse(Buffer.from(body ?? '', 'base64url').toString()) as Record<
    string,
    unknown
  >;
}

async function startWith(query: string) {
  const res = await testApp.request
    .get(`${START}${query}`)
    .set('Authorization', `Bearer ${user.token}`);
  expect(res.status).toBe(200);
  const url = new URL((res.body as { url: string }).url);
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const set = raw.find((c) => c.startsWith(`${STATE_COOKIE}=`)) ?? '';
  return {
    state: url.searchParams.get('state') ?? '',
    cookie: set.split(';')[0] ?? '',
  };
}

/** Hit the callback; answers the full landing: path + every result param. */
async function land(query: Record<string, string>, cookie: string) {
  const res = await testApp.request
    .get(CALLBACK)
    .query(query)
    .set('Cookie', cookie);
  expect(res.status).toBe(302);
  const loc = new URL(String(res.headers.location));
  return {
    path: loc.pathname,
    resume: loc.searchParams.get('resume'),
    connected: loc.searchParams.get('connected'),
    error: loc.searchParams.get('error'),
  };
}

describe('GET /users/me/calendars/oauth/:provider/start ?return (ROK-2022)', () => {
  it('return=onboarding → the signed state carries t=onboarding', async () => {
    const s = await startWith('?return=onboarding');
    expect(stateBody(s.state)).toMatchObject({ t: 'onboarding' });
  });

  it('no return → the state has no t claim', async () => {
    const s = await startWith('');
    expect(stateBody(s.state)).not.toHaveProperty('t');
  });

  it.each([['evil'], ['/onboarding'], ['https%3A%2F%2Fevil.test']])(
    'return=%s → 400, no binding cookie set',
    async (value) => {
      const res = await testApp.request
        .get(`${START}?return=${value}`)
        .set('Authorization', `Bearer ${user.token}`);
      expect(res.status).toBe(400);
      const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
      expect(cookies.some((c) => c.startsWith(`${STATE_COOKIE}=`))).toBe(false);
    },
  );
});

describe('GET /calendar-sync/oauth/:provider/callback with t=onboarding (ROK-2022)', () => {
  it('connect → 302 /onboarding?resume=calendar&connected=google', async () => {
    stubGoogle(OK);
    const s = await startWith('?return=onboarding');
    expect(
      await land({ code: 'auth-code-1', state: s.state }, s.cookie),
    ).toEqual({
      path: '/onboarding',
      resume: 'calendar',
      connected: 'google',
      error: null,
    });
  });

  it('provider error=access_denied → /onboarding?resume=calendar&error=denied', async () => {
    const spy = stubGoogle(OK);
    const s = await startWith('?return=onboarding');
    expect(
      await land({ error: 'access_denied', state: s.state }, s.cookie),
    ).toEqual({
      path: '/onboarding',
      resume: 'calendar',
      connected: null,
      error: 'denied',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('a connect failure thrown after the state verified still returns to the wizard', async () => {
    jest
      .spyOn(connectHelpers, 'upsertCalendarConnection')
      .mockRejectedValue(new TypeError('db down'));
    jest.spyOn(sentryActual, 'captureException').mockImplementation(() => 'id');
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    stubGoogle(OK);
    const s = await startWith('?return=onboarding');
    expect(
      await land({ code: 'auth-code-1', state: s.state }, s.cookie),
    ).toEqual({
      path: '/onboarding',
      resume: 'calendar',
      connected: null,
      error: 'unavailable',
    });
  });

  it('kill switch off before the state verifies → the default Integrations landing', async () => {
    const s = await startWith('?return=onboarding');
    await setCalendarSyncEnabled(testApp.app.get(SettingsService), false);
    expect(await land({ code: 'c', state: s.state }, s.cookie)).toEqual({
      path: '/profile/integrations',
      resume: null,
      connected: null,
      error: 'disabled',
    });
  });

  it('no t (regression guard) → unchanged /profile/integrations?connected=google', async () => {
    stubGoogle(OK);
    const s = await startWith('');
    expect(
      await land({ code: 'auth-code-1', state: s.state }, s.cookie),
    ).toEqual({
      path: '/profile/integrations',
      resume: null,
      connected: 'google',
      error: null,
    });
  });
});
