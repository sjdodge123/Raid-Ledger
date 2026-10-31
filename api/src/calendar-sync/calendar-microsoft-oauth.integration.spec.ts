/**
 * ROK-1597 §6 T19: Microsoft (Outlook) OAuth start + callback against
 * Postgres. Graph + the token endpoint are spies on `microsoftHttp`
 * (`calendar-microsoft.integration.spec-helpers.ts`); everything else is
 * real — the signed state, the binding cookie, the encrypted upsert, the
 * first-connect read consent and the 302 landing. The app's read + write
 * workers are closed for the file so the queued first read never runs
 * (it would otherwise reach the real network once the spies are restored).
 */
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';
import {
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
} from '../settings/settings-calendar-sync.helpers';
import {
  CALENDAR_READ_QUEUE,
  CALENDAR_WRITE_QUEUE,
  readSyncJobId,
} from './calendar-sync.constants';
import { MS_TOKEN_URL } from './providers/microsoft/microsoft-graph.constants';
import { CalendarReadProcessor } from './read/calendar-read.processor';
import { buildRedirectUris } from './services/calendar-sync-admin.helpers';
import { mintCalendarOAuthState } from './services/calendar-oauth-state.helpers';
import {
  decryptCalendarCredentials,
  isEncryptedCredentials,
} from './services/calendar-credentials.helpers';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import {
  connectMicrosoft,
  enableMicrosoft,
  formsTo,
  installGraph,
  landMicrosoft,
  MS_ACCESS,
  MS_FAKE_CLIENT_ID,
  MS_MAIL,
  MS_REFRESH,
  MS_START,
  MS_STATE_COOKIE,
  MS_SUBJECT,
  msStateCookieFor,
  startMicrosoft,
} from './calendar-microsoft.integration.spec-helpers';

let testApp: TestApp;
let readQueue: Queue;
let user: { userId: number; token: string };
let seq = 0;

beforeAll(async () => {
  testApp = await getTestApp();
  readQueue = testApp.app.get<Queue>(getQueueToken(CALENDAR_READ_QUEUE));
  await testApp.app.get(CalendarReadProcessor).worker.close(true);
  await testApp.app.get(CalendarWriteProcessor).worker.close(true);
});

beforeEach(async () => {
  await enableMicrosoft(testApp);
  seq += 1;
  user = await createMemberAndLogin(
    testApp,
    `cal-ms-oauth-${seq}`,
    `cal-ms-oauth-${seq}@example.test`,
  );
});

afterEach(async () => {
  jest.restoreAllMocks();
  await readQueue.drain(true);
  await testApp.app.get<Queue>(getQueueToken(CALENDAR_WRITE_QUEUE)).drain(true);
  await setCalendarSyncEnabled(testApp.app.get(SettingsService), false);
  testApp.seed = await truncateAllTables(testApp.db);
});

function rowsOf(userId: number) {
  return testApp.db
    .select()
    .from(schema.calendarConnections)
    .where(eq(schema.calendarConnections.userId, userId));
}

describe('GET /users/me/calendars/oauth/microsoft/start', () => {
  it('404s when Microsoft has no client configured', async () => {
    await setCalendarProviderConfig(
      testApp.app.get(SettingsService),
      'microsoft',
      {
        clientId: '',
        clientSecret: '',
      },
    );
    const res = await testApp.request
      .get(MS_START)
      .set('Authorization', `Bearer ${user.token}`);
    // mutation: make MicrosoftCalendarAdapter.isConfigured() return true → 200
    expect(res.status).toBe(404);
  });

  it('answers the Microsoft authorize URL (PKCE, select_account, the ruled scopes) and sets the binding cookie', async () => {
    const s = await startMicrosoft(testApp, user.token);
    // mutation: MS_LOGIN in microsoft-graph.constants.ts → another host/tenant
    expect(`${s.url.origin}${s.url.pathname}`).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    );
    // mutation: drop client_id from buildMicrosoftAuthUrl
    expect(s.url.searchParams.get('client_id')).toBe(MS_FAKE_CLIENT_ID);
    // mutation: add/remove an entry in MS_SCOPES
    expect(s.url.searchParams.get('scope')).toBe(
      'offline_access User.Read Calendars.ReadWrite',
    );
    // mutation: drop prompt: 'select_account' from buildMicrosoftAuthUrl
    expect(s.url.searchParams.get('prompt')).toBe('select_account');
    // mutation: code_challenge_method 'plain' in buildMicrosoftAuthUrl
    expect(s.url.searchParams.get('code_challenge_method')).toBe('S256');
    // mutation: pass the verifier instead of its S256 hash as code_challenge
    expect(s.url.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    // mutation: oauthCallbackPath('microsoft') → the google path
    expect(s.url.searchParams.get('redirect_uri')).toBe(
      (await buildRedirectUris(testApp.app.get(SettingsService))).microsoft,
    );
    // mutation: LINK_KEYS.microsoft → 'calendar-google' in the oauth controller
    expect(s.setCookie.startsWith(`${MS_STATE_COOKIE}=`)).toBe(true);
    // mutation: drop httpOnly from bindLinkStateToBrowser's cookie options
    expect(s.setCookie).toMatch(/HttpOnly/i);
  });
});

describe('GET /calendar-sync/oauth/microsoft/callback', () => {
  it('stores one encrypted active row with read consent, queues the first read, lands on ?connected=microsoft', async () => {
    const { forms } = installGraph();
    const landed = await connectMicrosoft(testApp, user.token);
    // mutation: provider key 'google' in the callback's landing redirect
    expect(landed).toEqual({ connected: 'microsoft', error: null });
    const [form] = formsTo(forms, MS_TOKEN_URL);
    // mutation: drop code_verifier from exchangeMicrosoftCode's form
    expect(form?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // mutation: send the google redirect URI to the Microsoft token endpoint
    expect(form?.redirect_uri).toBe(
      (await buildRedirectUris(testApp.app.get(SettingsService))).microsoft,
    );
    const [row] = nonEmpty(await rowsOf(user.userId), 'connection');
    // mutation: subject from `mail` instead of `/me` id in fetchMicrosoftIdentity;
    // or drop the microsoft branch of grantAllowsRead (read flags stay false)
    expect(row).toMatchObject({
      provider: 'microsoft',
      accountSubject: MS_SUBJECT,
      accountLabel: MS_MAIL,
      status: 'active',
      readAccessGranted: true,
      readEnabled: true,
      writeEnabled: false,
    });
    // mutation: write plain JSON credentials in upsertCalendarConnection
    expect(row.credentialsEncrypted).not.toContain(MS_REFRESH);
    expect(isEncryptedCredentials(row.credentialsEncrypted)).toBe(true);
    // mutation: keep the stored refresh token null in exchangeMicrosoftCode
    expect(decryptCalendarCredentials(row.credentialsEncrypted)).toMatchObject({
      kind: 'oauth',
      accessToken: MS_ACCESS,
      refreshToken: MS_REFRESH,
    });
    const job = await readQueue.getJob(readSyncJobId(row.id));
    // mutation: skip enqueueReadSync after applyFirstConnectRead
    expect(job?.id).toBe(readSyncJobId(row.id));
  });

  it('a binding cookie for another browser → ?error=state, the token endpoint never called, no row', async () => {
    const { forms } = installGraph();
    const { state } = mintCalendarOAuthState({
      uid: user.userId,
      provider: 'microsoft',
      bindToBrowser: () => 'binding-a',
    });
    const landed = await landMicrosoft(
      testApp,
      { code: 'ms-auth-code-1', state },
      msStateCookieFor('binding-b'),
    );
    // mutation: skip the cookie-hash comparison in the callback state check
    expect(landed.error).toBe('state');
    expect(forms).not.toHaveBeenCalled();
    expect(await rowsOf(user.userId)).toHaveLength(0);
  });

  it('a token without Calendars.ReadWrite → ?error=scopes, no row', async () => {
    installGraph('token-no-calendar-scope');
    const landed = await connectMicrosoft(testApp, user.token);
    // mutation: MS_REQUIRED_SCOPES → [] (the grant is stored without calendars)
    expect(landed.error).toBe('scopes');
    expect(await rowsOf(user.userId)).toHaveLength(0);
  });
});
