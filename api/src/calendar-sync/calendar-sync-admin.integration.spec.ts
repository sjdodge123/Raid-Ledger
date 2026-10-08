/**
 * Calendar Sync admin settings — integration (ROK-1591).
 *
 * `GET/PUT /admin/settings/calendar-sync` through the real controller, guards
 * and SettingsService against Postgres: admin-only, the default read shape,
 * the PUT round-trip, the secret never leaving the server (body, raw text or
 * the app_settings row), '' clears vs omitted-unchanged, redirect URIs built
 * from CLIENT_URL, and 400 on an invalid body with nothing persisted.
 */
import { eq } from 'drizzle-orm';
import { AdminCalendarSyncSettingsSchema } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import {
  truncateAllTables,
  loginAsAdmin,
} from '../common/testing/integration-helpers';
import { createMemberAndLogin } from '../events/signups.integration.spec-helpers';
import * as schema from '../drizzle/schema';
import { SETTING_KEYS } from '../drizzle/schema';
import { SettingsService } from '../settings/settings.service';

const ROUTE = '/admin/settings/calendar-sync';
/** Distinctive so a substring search over any response cannot false-match. */
const SECRET = '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ak-7f3a9c';
const CLIENT_ID = 'rok1591-client.apps.googleusercontent.com';

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

function getAsAdmin() {
  return testApp.request
    .get(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`);
}

function putAsAdmin(body: unknown) {
  return testApp.request
    .put(ROUTE)
    .set('Authorization', `Bearer ${adminToken}`)
    .send(body as object);
}

/** The env's CLIENT_URL — test-app.ts sets it; the app_settings key is unset. */
function envClientUrl(): string {
  const url = process.env.CLIENT_URL;
  if (!url) throw new Error('CLIENT_URL is not set in the integration env');
  return url.replace(/\/+$/, '');
}

function expectedRedirectUris(base: string) {
  return {
    google: `${base}/api/calendar-sync/oauth/google/callback`,
    microsoft: `${base}/api/calendar-sync/oauth/microsoft/callback`,
  };
}

async function storedSecretRow() {
  const rows = await testApp.db
    .select()
    .from(schema.appSettings)
    .where(
      eq(schema.appSettings.key, SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET),
    );
  return rows[0];
}

/** Seed google id + secret (and the switch) through the real PUT. */
async function seedGoogleConfig(): Promise<void> {
  const res = await putAsAdmin({
    enabled: true,
    google: { clientId: CLIENT_ID, clientSecret: SECRET },
  });
  expect(res.status).toBe(200);
}

describe('auth', () => {
  it('rejects an unauthenticated GET and PUT with 401', async () => {
    expect((await testApp.request.get(ROUTE)).status).toBe(401);
    const put = await testApp.request.put(ROUTE).send({ enabled: true });
    expect(put.status).toBe(401);
  });

  it('rejects a non-admin with 403 and persists nothing from a member PUT', async () => {
    const { token } = await createMemberAndLogin(
      testApp,
      'calmember',
      'calmember@test.local',
    );
    const get = await testApp.request
      .get(ROUTE)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(403);
    const put = await testApp.request
      .put(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .send({ enabled: true, google: { clientId: 'x', clientSecret: 'y' } });
    expect(put.status).toBe(403);

    const after = await getAsAdmin();
    expect(after.body.enabled).toBe(false);
    expect(after.body.google).toEqual({ clientId: null, hasSecret: false });
  });
});

describe('GET default', () => {
  it('returns the switch off, nothing configured, contract-valid', async () => {
    const res = await getAsAdmin();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: false,
      google: { clientId: null, hasSecret: false },
      microsoft: { clientId: null, hasSecret: false },
      redirectUris: expectedRedirectUris(envClientUrl()),
    });
    expect(() => AdminCalendarSyncSettingsSchema.parse(res.body)).not.toThrow();
  });
});

describe('PUT then GET round-trip', () => {
  it('persists the switch + google client, reporting hasSecret only', async () => {
    const put = await putAsAdmin({
      enabled: true,
      google: { clientId: CLIENT_ID, clientSecret: SECRET },
    });
    expect(put.status).toBe(200);

    const get = await getAsAdmin();
    expect(get.status).toBe(200);
    expect(get.body).toEqual({
      enabled: true,
      google: { clientId: CLIENT_ID, hasSecret: true },
      microsoft: { clientId: null, hasSecret: false },
      redirectUris: expectedRedirectUris(envClientUrl()),
    });
    // PUT answers with the same fresh read shape.
    expect(put.body).toEqual(get.body);
    expect(() => AdminCalendarSyncSettingsSchema.parse(get.body)).not.toThrow();
  });

  it('trims stored values', async () => {
    await putAsAdmin({ google: { clientId: `  ${CLIENT_ID}  ` } });
    const get = await getAsAdmin();
    expect(get.body.google.clientId).toBe(CLIENT_ID);
  });
});

describe('the secret never leaves the server', () => {
  it('is absent from the PUT and GET bodies and raw text', async () => {
    const put = await putAsAdmin({
      enabled: true,
      google: { clientId: CLIENT_ID, clientSecret: SECRET },
    });
    const get = await getAsAdmin();
    for (const res of [put, get]) {
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
      expect(res.text).not.toContain(SECRET);
      expect(JSON.stringify(res.body)).not.toContain('clientSecret');
    }
  });

  it('is stored encrypted, never as plaintext', async () => {
    await seedGoogleConfig();
    const row = await storedSecretRow();
    expect(row).toBeDefined();
    expect(row?.encryptedValue).not.toContain(SECRET);
    const settings = testApp.app.get(SettingsService);
    expect(await settings.get(SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET)).toBe(
      SECRET,
    );
  });
});

describe("'' clears, omitted leaves unchanged", () => {
  it("clears the secret on clientSecret: '' and keeps the client id", async () => {
    await seedGoogleConfig();
    const put = await putAsAdmin({ google: { clientSecret: '' } });
    expect(put.status).toBe(200);
    const get = await getAsAdmin();
    expect(get.body.google).toEqual({ clientId: CLIENT_ID, hasSecret: false });
    expect(await storedSecretRow()).toBeUndefined();
  });

  it('clears a whitespace-only client id', async () => {
    await seedGoogleConfig();
    await putAsAdmin({ google: { clientId: '   ' } });
    const get = await getAsAdmin();
    expect(get.body.google).toEqual({ clientId: null, hasSecret: true });
  });

  it('leaves the secret alone when the key is omitted', async () => {
    await seedGoogleConfig();
    const put = await putAsAdmin({ google: { clientId: 'rotated-client-id' } });
    expect(put.status).toBe(200);
    const get = await getAsAdmin();
    expect(get.body.google).toEqual({
      clientId: 'rotated-client-id',
      hasSecret: true,
    });
    const settings = testApp.app.get(SettingsService);
    expect(await settings.get(SETTING_KEYS.CALENDAR_GOOGLE_CLIENT_SECRET)).toBe(
      SECRET,
    );
  });

  it('leaves the provider config alone when only the switch changes', async () => {
    await seedGoogleConfig();
    await putAsAdmin({ enabled: false });
    const get = await getAsAdmin();
    expect(get.body.enabled).toBe(false);
    expect(get.body.google).toEqual({ clientId: CLIENT_ID, hasSecret: true });
  });
});

describe('redirectUris derive from CLIENT_URL', () => {
  it('uses the env CLIENT_URL when no client_url setting exists', async () => {
    const res = await getAsAdmin();
    expect(res.body.redirectUris).toEqual(expectedRedirectUris(envClientUrl()));
    expect(res.body.redirectUris.google).toMatch(
      /\/api\/calendar-sync\/oauth\/google\/callback$/,
    );
    expect(res.body.redirectUris.microsoft).toMatch(
      /\/api\/calendar-sync\/oauth\/microsoft\/callback$/,
    );
  });

  it('follows the client_url setting, trailing slash stripped', async () => {
    const settings = testApp.app.get(SettingsService);
    await settings.set(SETTING_KEYS.CLIENT_URL, 'https://slot-7.rok1591.test/');
    const res = await getAsAdmin();
    expect(res.body.redirectUris).toEqual(
      expectedRedirectUris('https://slot-7.rok1591.test'),
    );
  });
});

describe('invalid body → 400, nothing persisted', () => {
  const cases: Array<[string, unknown]> = [
    ['an unknown top-level key', { enabled: true, bogus: 1 }],
    ['an unknown provider key', { enabled: true, google: { secret: 'x' } }],
    ['a non-boolean switch', { enabled: 'yes' }],
    [
      'a client id over 512 chars',
      { enabled: true, google: { clientId: 'a'.repeat(513) } },
    ],
    [
      'a client secret over 512 chars',
      { enabled: true, google: { clientSecret: 'a'.repeat(513) } },
    ],
    ['an unknown provider', { enabled: true, apple: { clientId: 'x' } }],
  ];

  it.each(cases)('rejects %s', async (_label, body) => {
    const res = await putAsAdmin(body);
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed');

    const get = await getAsAdmin();
    expect(get.body.enabled).toBe(false);
    expect(get.body.google).toEqual({ clientId: null, hasSecret: false });
  });
});
