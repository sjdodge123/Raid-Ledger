/**
 * ROK-2371: fixtures for `google-signin.integration.spec.ts`. Google is the
 * calendar spec's `googleHttp.googleFormPost` spy (`stubGoogle`); the signed
 * state, browser-binding cookie, seed, pending identity and session are real.
 */
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Response as TestResponse } from 'supertest';
import type { TestApp } from '../../common/testing/test-app';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { setCalendarProviderConfig } from '../../settings/settings-calendar-sync.helpers';
import { setGoogleSigninEnabled } from '../../settings/settings-google-signin.helpers';
import {
  FAKE_CLIENT_ID,
  idToken,
  type GoogleStub,
} from '../../calendar-sync/calendar-oauth.integration.spec-helpers';

export const SIGNIN_START = '/auth/google';
export const SIGNIN_CALLBACK = '/auth/google/callback';
export const FIRST_TIME = '/auth/first-time';
export const FIRST_TIME_CREATE = '/auth/first-time/create';
export const STATE_COOKIE = 'rl_link_state_google-signin';
export const PENDING_COOKIE = 'rl_pending_identity';
export const REFRESH_COOKIE = 'rl_rt';

/** Fail loudly on a missing value (strict-TS: no `!` outside expect). */
export function must<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

/** Toggle + calendar Google client (the sign-in reuses that client). */
export async function configureGoogleSignin(
  testApp: TestApp,
  enabled: boolean,
): Promise<void> {
  const settings = testApp.app.get(SettingsService);
  await setCalendarProviderConfig(settings, 'google', {
    clientId: FAKE_CLIENT_ID,
    clientSecret: 'integration-client-secret',
  });
  await setGoogleSigninEnabled(settings, enabled);
}

function rawCookies(res: TestResponse): string[] {
  const raw: unknown = res.headers['set-cookie'];
  if (typeof raw === 'string') return [raw];
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === 'string');
}

/** `name → "name=value"` for every cookie the response SET (not cleared). */
export function setCookies(res: TestResponse): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of rawCookies(res)) {
    const pair = line.split(';')[0] ?? '';
    const eqAt = pair.indexOf('=');
    if (eqAt <= 0 || eqAt === pair.length - 1) continue;
    out.set(pair.slice(0, eqAt), pair);
  }
  return out;
}

export interface StartedSignin {
  url: URL;
  state: string;
  nonce: string;
  challenge: string;
  /** `rl_link_state_google-signin=<sha256(r)>` for this "browser". */
  cookie: string;
}

/** `GET /auth/google` → the Google authorize URL + this browser's cookie. */
export async function startSignin(
  testApp: TestApp,
  query: Record<string, string> = {},
  cookie?: string,
): Promise<StartedSignin> {
  const req = testApp.request.get(SIGNIN_START).query(query);
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  if (res.status !== 302) {
    throw new Error(`startSignin: expected 302, got ${res.status}`);
  }
  const url = new URL(String(res.headers.location));
  return {
    url,
    state: must(url.searchParams.get('state'), 'state param'),
    nonce: must(url.searchParams.get('nonce'), 'nonce param'),
    challenge: must(
      url.searchParams.get('code_challenge'),
      'code_challenge param',
    ),
    cookie: must(setCookies(res).get(STATE_COOKIE), 'state cookie'),
  };
}

export interface Landed {
  location: URL;
  cookies: Map<string, string>;
}

/** Hit the callback with an optional Cookie header; it always 302s. */
export async function landCallback(
  testApp: TestApp,
  query: Record<string, string>,
  cookie?: string,
): Promise<Landed> {
  const req = testApp.request.get(SIGNIN_CALLBACK).query(query);
  const res = await (cookie ? req.set('Cookie', cookie) : req);
  if (res.status !== 302) {
    throw new Error(`landCallback: expected 302, got ${res.status}`);
  }
  return {
    location: new URL(String(res.headers.location)),
    cookies: setCookies(res),
  };
}

/** Google's token response carrying an id_token with these claims. */
export function tokenWith(claims: Record<string, unknown>): GoogleStub {
  return {
    token: {
      status: 200,
      json: {
        access_token: 'ya29.FAKE-SIGNIN-ACCESS',
        expires_in: 3599,
        token_type: 'Bearer',
        id_token: idToken(claims),
      },
    },
  };
}

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

type UserInsert = typeof schema.users.$inferInsert;

/** Insert a member (no Discord unless given) and return its row. */
export async function insertUser(
  testApp: TestApp,
  values: Partial<UserInsert> & { username: string },
): Promise<typeof schema.users.$inferSelect> {
  const [user] = await testApp.db
    .insert(schema.users)
    .values({ discordId: null, role: 'member', ...values })
    .returning();
  return must(user, `inserted user ${values.username}`);
}

/** Link a Google `sub` to a user, never used yet (`last_used_at` NULL). */
export async function linkGoogleIdentity(
  testApp: TestApp,
  userId: number,
  sub: string,
  email: string,
): Promise<void> {
  await testApp.db
    .insert(schema.userAuthIdentities)
    .values({ userId, provider: 'google', subject: sub, email });
}

export function identitiesOf(testApp: TestApp, userId: number) {
  return testApp.db
    .select()
    .from(schema.userAuthIdentities)
    .where(eq(schema.userAuthIdentities.userId, userId));
}

export function identitiesForSub(testApp: TestApp, sub: string) {
  return testApp.db
    .select()
    .from(schema.userAuthIdentities)
    .where(eq(schema.userAuthIdentities.subject, sub));
}

export function refreshRowsOf(testApp: TestApp, userId: number) {
  return testApp.db
    .select()
    .from(schema.refreshTokens)
    .where(eq(schema.refreshTokens.userId, userId));
}

export async function userCount(testApp: TestApp): Promise<number> {
  return (await testApp.db.select({ id: schema.users.id }).from(schema.users))
    .length;
}
