/**
 * ROK-1597 T2, T3, T4, T18 (account): MicrosoftCalendarAdapter over the
 * spied `microsoft-http` seam — the first real adapter to run the shared
 * account conformance suite — plus rotation, the missing-scope refusal, the
 * unconfigured path and registry resolution.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import * as microsoftHttp from './microsoft-http';
import { MicrosoftCalendarAdapter } from './microsoft.adapter';
import {
  MissingScopesError,
  ProviderNotConfiguredError,
} from '../calendar-provider.errors';
import type {
  CalendarAccountProvider,
  OAuthCredentials,
} from '../calendar-provider.interface';
import {
  CalendarProviderRegistry,
  type DemoModeSource,
} from '../calendar-provider.registry';
import { describeCalendarProviderConformance } from '../testing/calendar-provider.conformance.spec-helpers';

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', `${name}.json`), 'utf8'),
  ) as unknown;
const ok = (json: unknown) => ({ status: 200, json, retryAfter: null });
const VALID_CODE = 'valid-ms-code';
const PARTIAL_CODE = 'partial-ms-code';
const WORK_ID = '00000000-1111-2222-3333-444444444444';
const STORED: OAuthCredentials = {
  kind: 'oauth',
  accessToken: 'stale-access',
  refreshToken: 'stored-refresh',
  expiresAt: '2026-01-01T00:00:00.000Z',
  scopes: ['Calendars.ReadWrite'],
};

function adapter(values: Record<string, string>): MicrosoftCalendarAdapter {
  const settings = {
    get: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
  } as unknown as SettingsCore;
  return new MicrosoftCalendarAdapter(settings);
}
const configured = () =>
  adapter({
    [SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_ID]: 'fake-ms-client-id',
    [SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_SECRET]: 'fake-secret',
  });

/** Token endpoint fake: valid/partial codes grant, anything else is revoked. */
function tokenEndpoint(form: Record<string, string>) {
  if (form.grant_type === 'refresh_token') {
    return Promise.resolve(ok(fixture('token-rotated')));
  }
  if (form.code === VALID_CODE) return Promise.resolve(ok(fixture('token-ok')));
  if (form.code === PARTIAL_CODE) {
    return Promise.resolve(ok(fixture('token-no-calendar-scope')));
  }
  return Promise.resolve({
    status: 400,
    json: fixture('token-invalid-grant'),
    retryAfter: null,
  });
}

let post: jest.SpyInstance;
let graph: jest.SpyInstance;
beforeEach(() => {
  post = jest
    .spyOn(microsoftHttp, 'microsoftFormPost')
    .mockImplementation((_url, form) => tokenEndpoint(form));
  graph = jest
    .spyOn(microsoftHttp, 'microsoftJsonRequest')
    .mockResolvedValue(ok(fixture('me-work')));
});
afterEach(() => jest.restoreAllMocks());

describeCalendarProviderConformance('MicrosoftCalendarAdapter', () => ({
  provider: configured(),
  validCode: VALID_CODE,
  expectedSubject: WORK_ID,
  expectedLabel: 'raider@contoso.example',
  invalidCode: 'expired-ms-code-123',
  redirectUri:
    'https://slot-1.example/api/calendar-sync/oauth/microsoft/callback',
}));

describe('MicrosoftCalendarAdapter', () => {
  it('is configured only with both client id and secret', async () => {
    await expect(configured().isConfigured()).resolves.toBe(true);
    const noSecret = adapter({
      [SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_ID]: 'fake-ms-client-id',
    });
    await expect(noSecret.isConfigured()).resolves.toBe(false);
    await expect(
      noSecret.buildAuthUrl({
        state: 's',
        codeChallenge: 'c',
        redirectUri: 'https://x/cb',
      }),
    ).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it('asks for the same ruled scopes whatever the intent', async () => {
    const input = {
      state: 's',
      codeChallenge: 'c',
      redirectUri: 'https://x/cb',
    };
    const scopeOf = async (intent?: 'connect' | 'primary' | 'read') =>
      new URL(
        await configured().buildAuthUrl(intent ? { ...input, intent } : input),
      ).searchParams.get('scope');
    const ruled = 'offline_access User.Read Calendars.ReadWrite';
    await expect(scopeOf()).resolves.toBe(ruled);
    await expect(scopeOf('primary')).resolves.toBe(ruled);
    await expect(scopeOf('read')).resolves.toBe(ruled);
  });

  it('refuses a grant without Calendars.ReadWrite before reading /me (T4)', async () => {
    const err: unknown = await configured()
      .connect({
        code: PARTIAL_CODE,
        codeVerifier: 'v',
        redirectUri: 'https://x/cb',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingScopesError);
    expect(err instanceof MissingScopesError && err.missing).toEqual([
      'Calendars.ReadWrite',
    ]);
    expect(graph).not.toHaveBeenCalled();
  });

  it('labels a personal account by userPrincipalName (T5)', async () => {
    graph.mockResolvedValue(ok(fixture('me-personal')));
    const result = await configured().connect({
      code: VALID_CODE,
      codeVerifier: 'v',
      redirectUri: 'https://x/cb',
    });
    expect(result.accountSubject).toBe('0123456789abcdef');
    expect(result.accountLabel).toBe('raider@outlook.example');
  });
});

describe('MicrosoftCalendarAdapter token lifecycle', () => {
  it('returns the rotated refresh token from refresh (T3)', async () => {
    const next = await configured().refresh(STORED);
    expect(next.refreshToken).toBe('M.C-FAKE-MS-REFRESH-TOKEN-rotated');
    expect(next.accessToken).toBe('EwB-FAKE-MS-ACCESS-TOKEN-refreshed');
    expect(next.scopes).toEqual(['Calendars.ReadWrite', 'User.Read']);
  });

  it('keeps the stored refresh token and scopes when the reply omits them (T3)', async () => {
    post.mockResolvedValueOnce(ok({ access_token: 'fresh', expires_in: 60 }));
    const next = await configured().refresh(STORED);
    expect(next.refreshToken).toBe('stored-refresh');
    expect(next.scopes).toEqual(['Calendars.ReadWrite']);
    expect(next.accessToken).toBe('fresh');
  });

  it('disconnect makes no network call (no per-grant revoke exists)', async () => {
    await expect(configured().disconnect(STORED)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });
});

describe('CalendarProviderRegistry with the Microsoft adapter (T18 account)', () => {
  const googleStub: CalendarAccountProvider = {
    key: 'google',
    isConfigured: jest.fn(),
    buildAuthUrl: jest.fn(),
    connect: jest.fn(),
    refresh: jest.fn(),
    disconnect: jest.fn(),
  };
  const settings: DemoModeSource = {
    getDemoMode: jest.fn().mockResolvedValue(false),
  };
  const ROW = { provider: 'microsoft', accountSubject: WORK_ID };

  it('resolves microsoft for connect, but routes no read or write yet', async () => {
    const ms = configured();
    const reg = new CalendarProviderRegistry(
      settings,
      googleStub,
      null,
      null,
      ms,
    );
    expect(reg.getAccountProvider('microsoft')).toBe(ms);
    expect(reg.getAccountProvider('google')).toBe(googleStub);
    await expect(reg.getAccountProviderForConnection(ROW)).resolves.toBe(ms);
    await expect(reg.getReadProviderForConnection(ROW)).resolves.toBeNull();
    await expect(reg.getWriteProviderForConnection(ROW)).resolves.toBeNull();
  });

  it('still resolves microsoft to null when the adapter is not injected', () => {
    const reg = new CalendarProviderRegistry(settings, googleStub, null, null);
    expect(reg.getAccountProvider('microsoft')).toBeNull();
  });
});
