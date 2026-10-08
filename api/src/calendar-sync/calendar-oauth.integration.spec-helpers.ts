/**
 * Shared fixtures for the ROK-1592 OAuth + disconnect integration specs.
 * Google is stubbed by spying on the `googleHttp` namespace (plan L14):
 * `jest.mock` never reaches the singleton app.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestApp } from '../common/testing/test-app';
import { SettingsService } from '../settings/settings.service';
import {
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
} from '../settings/settings-calendar-sync.helpers';
import * as googleHttp from './providers/google/google-http';
import { GOOGLE_REVOKE_URL } from './providers/google/google-oauth.helpers';

/** The fixtures' id_token `aud` (lane 2b). */
export const FAKE_CLIENT_ID = 'fake-client-id.apps.googleusercontent.com';
export const FIXTURE_SUB = '109876543210987654321';
export const FIXTURE_EMAIL = 'raider@example.test';
export const FIXTURE_ACCESS = 'ya29.FAKE-ACCESS-TOKEN-fixture';
export const FIXTURE_REFRESH = '1//FAKE-REFRESH-TOKEN-fixture';
export const STATE_COOKIE = 'rl_link_state_calendar-google';
export const START = '/users/me/calendars/oauth/google/start';
export const CALLBACK = '/calendar-sync/oauth/google/callback';

export type TokenFixture =
  'token-ok' | 'token-no-refresh' | 'token-missing-scope' | 'token-400';

export function fixture(name: TokenFixture): Record<string, unknown> {
  const path = join(
    __dirname,
    'providers',
    'google',
    '__fixtures__',
    `${name}.json`,
  );
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** An unsigned id_token with the given claims (the adapter checks iss/aud/exp only). */
export function idToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: 'https://accounts.google.com',
    aud: FAKE_CLIENT_ID,
    sub: FIXTURE_SUB,
    exp: 4102444800,
    iat: 1700000000,
    ...claims,
  })}.c2ln`;
}

/** The cookie value `bindLinkStateToBrowser` would set for binding `r`. */
export function stateCookieFor(r: string): string {
  return `${STATE_COOKIE}=${createHash('sha256').update(r).digest('hex')}`;
}

export interface GoogleStub {
  token: { status: number; json: unknown };
  revokeStatus?: number;
}

/** Spy on every Google form POST: token endpoint → `token`, revoke → `revokeStatus`. */
export function stubGoogle(stub: GoogleStub): jest.SpyInstance {
  return jest.spyOn(googleHttp, 'googleFormPost').mockImplementation((url) =>
    Promise.resolve(
      url === GOOGLE_REVOKE_URL
        ? { status: stub.revokeStatus ?? 200, json: null, retryAfter: null }
        : {
            status: stub.token.status,
            json: stub.token.json,
            retryAfter: null,
          },
    ),
  );
}

/** Form bodies the spy saw for one URL. */
export function formsSentTo(
  spy: jest.SpyInstance,
  url: string,
): Record<string, string>[] {
  return (spy.mock.calls as [string, Record<string, string>][])
    .filter(([u]) => u === url)
    .map(([, form]) => form);
}

/** Kill switch on + a configured Google client whose id matches the fixtures. */
export async function enableGoogle(
  testApp: TestApp,
  enabled = true,
): Promise<SettingsService> {
  const settings = testApp.app.get(SettingsService);
  await setCalendarSyncEnabled(settings, enabled);
  await setCalendarProviderConfig(settings, 'google', {
    clientId: FAKE_CLIENT_ID,
    clientSecret: 'integration-client-secret',
  });
  return settings;
}
