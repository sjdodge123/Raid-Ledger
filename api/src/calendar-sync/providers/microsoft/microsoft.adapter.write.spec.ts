/**
 * ROK-1597 T13 (specifics), T15, T16: MicrosoftCalendarAdapter writes over
 * the in-memory Graph — the `'primary'` alias, no attendees on any write,
 * the name-conflict adopt, upsert idempotency via the extended property,
 * delete of a missing copy, and the §3.5 write error mapping.
 */
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import {
  NotFoundError,
  ProviderAuthError,
  RateLimitError,
} from '../calendar-provider.errors';
import type {
  CopyEventInput,
  OAuthCredentials,
} from '../calendar-provider.interface';
import * as microsoftHttp from './microsoft-http';
import {
  FAKE_DEFAULT_CALENDAR_ID,
  FakeGraphCalendarApi,
} from './microsoft-graph-api.spec-helpers';
import { PREFER_IMMUTABLE_ID, PREFER_UTC } from './microsoft-graph.constants';
import { MicrosoftCalendarAdapter } from './microsoft.adapter';

const CREDS: OAuthCredentials = {
  kind: 'oauth',
  accessToken: 'ms-write-token',
  refreshToken: 'rt',
  expiresAt: '2026-11-01T00:00:00.000Z',
  scopes: ['Calendars.ReadWrite'],
};
const COPY: CopyEventInput = {
  copyId: 'rl:0123456789ab:42:7',
  title: 'Molten Core',
  description: 'https://raid.example.test/events/42',
  url: 'https://raid.example.test/events/42',
  start: new Date('2026-11-01T19:00:00.000Z'),
  end: new Date('2026-11-01T22:00:00.000Z'),
  tentative: false,
};

function setup(): { api: FakeGraphCalendarApi; a: MicrosoftCalendarAdapter } {
  const values: Record<string, string> = {
    [SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_ID]: 'fake-ms-client-id',
    [SETTING_KEYS.CALENDAR_MICROSOFT_CLIENT_SECRET]: 'fake-secret',
  };
  const settings = {
    get: jest.fn((key: string) => Promise.resolve(values[key] ?? null)),
  } as unknown as SettingsCore;
  const api = new FakeGraphCalendarApi();
  jest
    .spyOn(microsoftHttp, 'microsoftJsonRequest')
    .mockImplementation(api.handle);
  return { api, a: new MicrosoftCalendarAdapter(settings) };
}
const writes = (api: FakeGraphCalendarApi) =>
  api.requests.filter((r) => r.method === 'POST' || r.method === 'PATCH');

afterEach(() => jest.restoreAllMocks());

describe('MicrosoftCalendarAdapter write — Graph specifics', () => {
  it("'primary' writes go to /me/calendar/events (the main calendar, T15)", async () => {
    const { api, a } = setup();
    const ref = await a.upsertEvent(CREDS, 'primary', COPY, null);
    expect(ref.calendarId).toBe('primary');
    const post = writes(api).find((r) => r.method === 'POST');
    expect(post?.url).toBe(
      'https://graph.microsoft.com/v1.0/me/calendar/events',
    );
    const main = api.calendars.get(FAKE_DEFAULT_CALENDAR_ID);
    expect(main?.events.has(ref.providerEventId)).toBe(true);
  });

  it('no POST or PATCH body ever carries attendees; every call sends the bearer + Prefer UTC + ImmutableId', async () => {
    const { api, a } = setup();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    const ref = await a.upsertEvent(CREDS, cal, COPY, null);
    await a.upsertEvent(CREDS, cal, { ...COPY, benched: true }, ref);
    expect(writes(api).length).toBeGreaterThanOrEqual(3);
    for (const r of writes(api)) expect(r.body).not.toHaveProperty('attendees');
    for (const r of api.requests) {
      expect(r.accessToken).toBe('ms-write-token');
      expect(r.prefer).toEqual([PREFER_UTC, PREFER_IMMUTABLE_ID]);
    }
  });

  it('a benched copy is "(Bench) <title>" and free', async () => {
    const { api, a } = setup();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    const ref = await a.upsertEvent(
      CREDS,
      cal,
      { ...COPY, benched: true },
      null,
    );
    const event = api.findEvent(ref.providerEventId)?.event;
    expect([event?.subject, event?.showAs]).toEqual([
      '(Bench) Molten Core',
      'free',
    ]);
  });

  it('a name conflict on POST /me/calendars adopts the existing "Raid Ledger" calendar (T16)', async () => {
    const { api, a } = setup();
    api.addCalendar('AAMkADexisting-rl=', 'Raid Ledger');
    await expect(a.ensureRaidLedgerCalendar(CREDS, null)).resolves.toBe(
      'AAMkADexisting-rl=',
    );
    expect(
      [...api.calendars.values()].filter((c) => c.name === 'Raid Ledger'),
    ).toHaveLength(1);
  });

  it('a retried create with no ref adopts by the extended property — one copy, same id', async () => {
    const { api, a } = setup();
    const cal = await a.ensureRaidLedgerCalendar(CREDS, null);
    const first = await a.upsertEvent(CREDS, cal, COPY, null);
    const again = await a.upsertEvent(CREDS, cal, COPY, null);
    expect(again.providerEventId).toBe(first.providerEventId);
    expect(api.calendars.get(cal)?.events.size).toBe(1);
  });

  it('deleting a copy that never existed resolves (404 is success)', async () => {
    const { a } = setup();
    const ref = { calendarId: 'primary', providerEventId: 'AAMkADgone=' };
    await expect(a.deleteEvent(CREDS, ref)).resolves.toBeUndefined();
  });

  it('deleting a calendar already gone resolves', async () => {
    const { a } = setup();
    await expect(
      a.deleteRaidLedgerCalendar(CREDS, 'AAMkADgone-cal='),
    ).resolves.toBeUndefined();
  });

  it('a PATCH of a copy deleted remotely throws NotFound (the caller recreates)', async () => {
    const { a } = setup();
    const ref = { calendarId: 'primary', providerEventId: 'AAMkADgone=' };
    await expect(
      a.upsertEvent(CREDS, 'primary', COPY, ref),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('429 with Retry-After → RateLimitError carrying the delay', async () => {
    const { api, a } = setup();
    api.failNext('rate');
    const err: unknown = await a
      .ensureRaidLedgerCalendar(CREDS, null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).toMatchObject({ retryAfterMs: 2000 });
  });

  it('403 on a write → ProviderAuthError("scope") (consent missing)', async () => {
    const { api, a } = setup();
    api.failNext('denied');
    const err: unknown = await a
      .upsertEvent(CREDS, 'primary', COPY, null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderAuthError);
    expect(err).toMatchObject({ reason: 'scope' });
  });
});
