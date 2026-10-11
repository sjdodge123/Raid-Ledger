import {
  NotFoundError,
  ProviderAuthError,
  TransientError,
} from '../calendar-provider.errors';
import type { CopyEventInput } from '../calendar-provider.interface';
import {
  describeCalendarProviderConformance,
  describeCalendarWriteConformance,
} from './calendar-provider.conformance.spec-helpers';
import { FAKE_PRIMARY_CALENDAR_ID } from './fake-calendar-store';
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

describeCalendarWriteConformance(() => {
  const provider = new FakeCalendarProvider();
  return {
    provider,
    credentials: { kind: 'caldav', username: 'u', appPassword: 'p' },
    removeCalendarRemotely: (id) => provider.store.removeCalendar(id),
    readCopy: (ref) => {
      const copy = provider.store.getCopy(ref.providerEventId);
      return Promise.resolve(
        copy ? { title: copy.title, busy: copy.busy } : null,
      );
    },
  };
}, 'FakeCalendarProvider');

const CREDS = { kind: 'caldav', username: 'u', appPassword: 'p' } as const;
const COPY: CopyEventInput = {
  copyId: 'rl:inst:42:7',
  title: 'Raid Night',
  description: 'https://raid.example/events/42',
  url: 'https://raid.example/events/42',
  start: new Date('2026-11-01T19:00:00.000Z'),
  end: new Date('2026-11-01T22:00:00.000Z'),
  tentative: true,
};

describe('FakeCalendarProvider write store', () => {
  it('hands out deterministic fake-cal-n / fake-evt-n ids and stores the copy', async () => {
    const p = new FakeCalendarProvider();
    const cal = await p.ensureRaidLedgerCalendar(CREDS, null);
    const ref = await p.upsertEvent(CREDS, cal, COPY, null);
    const onPrimary = await p.upsertEvent(
      CREDS,
      FAKE_PRIMARY_CALENDAR_ID,
      COPY,
      null,
    );
    expect(cal).toBe('fake-cal-1');
    expect(ref.providerEventId).toBe('fake-evt-1');
    expect(onPrimary).toMatchObject({
      calendarId: 'primary',
      providerEventId: 'fake-evt-2',
    });
    expect(p.store.calendarName(cal)).toBe('Raid Ledger');
    expect(p.store.copiesIn(cal)).toEqual([
      expect.objectContaining({
        copyId: 'rl:inst:42:7',
        title: '(Tentative) Raid Night',
        busy: false,
        start: COPY.start,
        end: COPY.end,
      }),
    ]);
  });

  it('a new etag on every write', async () => {
    const p = new FakeCalendarProvider();
    const a = await p.upsertEvent(CREDS, 'primary', COPY, null);
    const b = await p.upsertEvent(CREDS, 'primary', COPY, a);
    expect(b.etag).not.toBe(a.etag);
  });

  it('writing to a calendar that is gone is NotFoundError', async () => {
    const p = new FakeCalendarProvider();
    const cal = await p.ensureRaidLedgerCalendar(CREDS, null);
    p.store.removeCalendar(cal);
    await expect(p.upsertEvent(CREDS, cal, COPY, null)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('patching a copy deleted remotely is NotFoundError', async () => {
    const p = new FakeCalendarProvider();
    const ref = await p.upsertEvent(CREDS, 'primary', COPY, null);
    p.store.deleteCopy(ref.providerEventId);
    await expect(p.upsertEvent(CREDS, 'primary', COPY, ref)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('failNext fails exactly the next write calls, in order', async () => {
    const p = new FakeCalendarProvider();
    p.store.failNext(new ProviderAuthError('revoked'));
    p.store.failNext(new TransientError('503'));
    await expect(p.ensureRaidLedgerCalendar(CREDS, null)).rejects.toThrow(
      ProviderAuthError,
    );
    await expect(p.upsertEvent(CREDS, 'primary', COPY, null)).rejects.toThrow(
      TransientError,
    );
    expect(p.store.allCopies()).toEqual([]);
    await expect(p.ensureRaidLedgerCalendar(CREDS, null)).resolves.toBe(
      'fake-cal-1',
    );
  });
});
