import { ProviderAuthError } from '../calendar-provider.errors';
import { describeCalendarProviderConformance } from './calendar-provider.conformance';
import {
  FAKE_DEFAULT_SCOPES,
  FAKE_SUBJECT_PREFIX,
  FakeCalendarProvider,
  isFakeSubject,
} from './fake-calendar.provider';

const REDIRECT = 'https://raid.example/api/calendar-sync/oauth/google/callback';
const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
const input = (code: string) => ({
  code,
  codeVerifier: 'v',
  redirectUri: REDIRECT,
});

describeCalendarProviderConformance('FakeCalendarProvider', () => {
  const provider = new FakeCalendarProvider();
  provider.registerCode('code-ok', {
    id: 'alice',
    label: 'alice@example.test',
  });
  return {
    provider,
    validCode: 'code-ok',
    expectedSubject: 'demo-fake:alice',
    expectedLabel: 'alice@example.test',
    invalidCode: 'code-never-issued',
    redirectUri: REDIRECT,
  };
});

function fresh() {
  const p = new FakeCalendarProvider({ now: () => T0 });
  p.registerCode('code-ok', { id: 'alice', label: 'alice@example.test' });
  return p;
}

describe('FakeCalendarProvider grants and revokes', () => {
  it('is deterministic: the same clock and codes give the same grant', async () => {
    const [a, b] = await Promise.all([
      fresh().connect(input('code-ok')),
      fresh().connect(input('code-ok')),
    ]);
    expect(a).toEqual(b);
    expect(a.credentials).toEqual({
      kind: 'oauth',
      accessToken: 'fake-access-1',
      refreshToken: 'fake-refresh-alice-1',
      expiresAt: new Date(T0 + 3_600_000).toISOString(),
      scopes: [...FAKE_DEFAULT_SCOPES],
    });
  });

  it('spends a code on first use', async () => {
    const p = fresh();
    await p.connect(input('code-ok'));
    await expect(p.connect(input('code-ok'))).rejects.toBeInstanceOf(
      ProviderAuthError,
    );
  });

  it('logs the revoked refresh token and refuses to refresh it afterwards', async () => {
    const p = fresh();
    const { credentials } = await p.connect(input('code-ok'));
    const creds = {
      ...credentials,
      refreshToken: credentials.refreshToken ?? '',
    };
    await p.disconnect(creds);
    expect(p.revoked).toEqual(['fake-refresh-alice-1']);
    await expect(p.refresh(creds)).rejects.toBeInstanceOf(ProviderAuthError);
  });
});

describe('FakeCalendarProvider config and seeding', () => {
  it('ignores a caldav credential on disconnect', async () => {
    const p = fresh();
    await p.disconnect({ kind: 'caldav', username: 'u', appPassword: 'p' });
    expect(p.revoked).toEqual([]);
  });

  it('reports configuration as set', async () => {
    const p = new FakeCalendarProvider({ configured: false });
    await expect(p.isConfigured()).resolves.toBe(false);
    p.setConfigured(true);
    await expect(p.isConfigured()).resolves.toBe(true);
  });

  it('seeds a demo-fake: connection without a code, label null by default', () => {
    const seeded = fresh().seedConnection({ id: 'bob' });
    expect(seeded.accountSubject).toBe(`${FAKE_SUBJECT_PREFIX}bob`);
    expect(seeded.accountLabel).toBeNull();
    expect(isFakeSubject(seeded.accountSubject)).toBe(true);
    expect(isFakeSubject('109876543210987654321')).toBe(false);
  });

  it('reports a custom scope set when the account overrides it', () => {
    const seeded = fresh().seedConnection({ id: 'carol', scopes: ['openid'] });
    expect(seeded.credentials.scopes).toEqual(['openid']);
  });
});
