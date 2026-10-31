/**
 * ROK-1597 §6 T19: shared fixtures for the Microsoft (Outlook) integration
 * specs. Graph is the in-memory `FakeGraphCalendarApi` behind namespace spies
 * on `microsoftHttp` (`jest.mock` never reaches the singleton app): the token
 * endpoint answers `token-ok`, every JSON call goes to the fake. All ids and
 * secrets here are obviously fake — never a real tenant or app.
 */
import { createHash } from 'node:crypto';
import type { TestApp } from '../common/testing/test-app';
import { SettingsService } from '../settings/settings.service';
import {
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
} from '../settings/settings-calendar-sync.helpers';
import * as microsoftHttp from './providers/microsoft/microsoft-http';
import {
  FakeGraphCalendarApi,
  fixture,
} from './providers/microsoft/microsoft-graph-api.spec-helpers';

export const MS_FAKE_CLIENT_ID = '00000000-0000-0000-0000-00000000f4ce';
export const MS_START = '/users/me/calendars/oauth/microsoft/start';
export const MS_CALLBACK = '/calendar-sync/oauth/microsoft/callback';
export const MS_STATE_COOKIE = 'rl_link_state_calendar-microsoft';
/** `token-ok.json` / `me-work.json` values. */
export const MS_ACCESS = 'EwB-FAKE-MS-ACCESS-TOKEN-fixture';
export const MS_REFRESH = 'M.C-FAKE-MS-REFRESH-TOKEN-fixture';
export const MS_SUBJECT = '00000000-1111-2222-3333-444444444444';
export const MS_MAIL = 'raider@contoso.example';

/** Kill switch on + a configured (fake) Microsoft client. */
export async function enableMicrosoft(testApp: TestApp): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await setCalendarSyncEnabled(settings, true);
  await setCalendarProviderConfig(settings, 'microsoft', {
    clientId: MS_FAKE_CLIENT_ID,
    clientSecret: 'integration-ms-client-secret',
  });
}

export interface GraphStubs {
  api: FakeGraphCalendarApi;
  /** The token-endpoint spy (`(url, form)` per call). */
  forms: jest.SpyInstance;
}

/** Install the fake Graph + a token endpoint answering `tokenFixture`. */
export function installGraph(tokenFixture = 'token-ok'): GraphStubs {
  const api = new FakeGraphCalendarApi();
  jest
    .spyOn(microsoftHttp, 'microsoftJsonRequest')
    .mockImplementation(api.handle);
  const forms = jest
    .spyOn(microsoftHttp, 'microsoftFormPost')
    .mockImplementation(() =>
      Promise.resolve({
        status: tokenFixture.startsWith('token-invalid') ? 400 : 200,
        json: fixture(tokenFixture),
        retryAfter: null,
      }),
    );
  return { api, forms };
}

/** Form bodies the token spy saw for `url`. */
export function formsTo(
  spy: jest.SpyInstance,
  url: string,
): Record<string, string>[] {
  return (spy.mock.calls as [string, Record<string, string>][])
    .filter(([u]) => u === url)
    .map(([, form]) => form);
}

/** The cookie value `bindLinkStateToBrowser` would set for binding `r`. */
export function msStateCookieFor(r: string): string {
  return `${MS_STATE_COOKIE}=${createHash('sha256').update(r).digest('hex')}`;
}

export interface StartedOAuth {
  url: URL;
  state: string;
  setCookie: string;
  cookie: string;
}

/** `GET …/oauth/microsoft/start` as `token`; asserts the 200. */
export async function startMicrosoft(
  testApp: TestApp,
  token: string,
): Promise<StartedOAuth> {
  const res = await testApp.request
    .get(MS_START)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const url = new URL((res.body as { url: string }).url);
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const setCookie = raw.find((c) => c.startsWith(`${MS_STATE_COOKIE}=`)) ?? '';
  return {
    url,
    state: url.searchParams.get('state') ?? '',
    setCookie,
    cookie: setCookie.split(';')[0] ?? '',
  };
}

/** Hit the callback; answers the landing URL's `connected` / `error`. */
export async function landMicrosoft(
  testApp: TestApp,
  query: Record<string, string>,
  cookie?: string,
): Promise<{ connected: string | null; error: string | null }> {
  const req = testApp.request.get(MS_CALLBACK).query(query);
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  expect(res.status).toBe(302);
  const loc = new URL(String(res.headers.location));
  expect(loc.pathname).toBe('/profile/integrations');
  return {
    connected: loc.searchParams.get('connected'),
    error: loc.searchParams.get('error'),
  };
}

/** Start → callback with a valid code; answers the landing params. */
export async function connectMicrosoft(testApp: TestApp, token: string) {
  const s = await startMicrosoft(testApp, token);
  return landMicrosoft(
    testApp,
    { code: 'ms-auth-code-1', state: s.state },
    s.cookie,
  );
}
