/**
 * ROK-1597 T10-T12: MicrosoftCalendarAdapter read capability over
 * `FakeGraphCalendarApi` behind the spied `microsoft-http` seam. The shared
 * `describeCalendarReadConformance` needs write (its round-trip case), so
 * lane 7b-1 plugs this adapter into it; these cases mirror its read rows.
 */
import { Logger } from '@nestjs/common';
import { SETTING_KEYS } from '../../../drizzle/schema';
import type { SettingsCore } from '../../../settings/settings-bot.helpers';
import * as microsoftHttp from './microsoft-http';
import { MicrosoftCalendarAdapter } from './microsoft.adapter';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';
import type {
  OAuthCredentials,
  TimeRange,
} from '../calendar-provider.interface';
import {
  FAKE_DEFAULT_CALENDAR_ID as PRIMARY,
  FakeGraphCalendarApi,
  graphDateTime,
} from './microsoft-graph-api.spec-helpers';
import {
  MICROSOFT_EVENTS_SELECT,
  PREFER_IMMUTABLE_ID,
  PREFER_UTC,
  RL_COPY_PROP_ID,
} from './microsoft-graph.constants';

const CREDS: OAuthCredentials = {
  kind: 'oauth',
  accessToken: 'fake-graph-access',
  refreshToken: 'fake-refresh',
  expiresAt: '2026-11-01T00:00:00.000Z',
  scopes: ['Calendars.ReadWrite'],
};
const RANGE: TimeRange = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-11-29T00:00:00.000Z'),
};
const at = (iso: string) => new Date(`2026-11-${iso}:00.000Z`);

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
const busyAt = (api: FakeGraphCalendarApi, cal: string, day: string) =>
  api.seedEvent(cal, {
    start: at(`${day}T18:00`),
    end: at(`${day}T20:00`),
    busy: true,
  });

afterEach(() => jest.restoreAllMocks());

describe('MicrosoftCalendarAdapter.listCalendars (T10)', () => {
  it('maps isDefaultCalendar → primary and canEdit → writable', async () => {
    const { api, a } = setup();
    api.addCalendar('AAMkADshared=', 'Shared', false);
    const rows = await a.listCalendars(CREDS);
    expect(rows).toEqual([
      {
        id: PRIMARY,
        name: 'Calendar',
        primary: true,
        writable: true,
        isRaidLedger: false,
      },
      {
        id: 'AAMkADshared=',
        name: 'Shared',
        primary: false,
        writable: false,
        isRaidLedger: false,
      },
    ]);
  });

  it('refuses non-OAuth credentials before any call', async () => {
    const { api, a } = setup();
    await expect(
      a.listCalendars({ kind: 'caldav', username: 'u', appPassword: 'p' }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
    expect(api.requests).toHaveLength(0);
  });
});

describe('MicrosoftCalendarAdapter.fetchBusy (T10-T12)', () => {
  it('returns [start, end) blocks, drops Free and out-of-range events', async () => {
    const { api, a } = setup();
    busyAt(api, PRIMARY, '03');
    api.seedEvent(PRIMARY, {
      start: at('04T18:00'),
      end: at('04T20:00'),
      busy: false,
    });
    api.seedEvent(PRIMARY, {
      start: new Date('2026-12-10T18:00:00.000Z'),
      end: new Date('2026-12-10T19:00:00.000Z'),
      busy: true,
    });
    const out = await a.fetchBusy(CREDS, RANGE, [PRIMARY]);
    expect(out).toEqual({
      blocks: [{ start: at('03T18:00'), end: at('03T20:00'), allDay: false }],
    });
  });

  it('a copy carrying our extended property reads back with ourId', async () => {
    const { api, a } = setup();
    api.seedRaw(PRIMARY, {
      showAs: 'busy',
      start: graphDateTime(at('05T19:00')),
      end: graphDateTime(at('05T22:00')),
      singleValueExtendedProperties: [
        { id: RL_COPY_PROP_ID, value: 'rl:0123456789ab:42:7' },
      ],
    });
    const out = await a.fetchBusy(CREDS, RANGE, [PRIMARY]);
    expect(out.blocks).toEqual([
      {
        start: at('05T19:00'),
        end: at('05T22:00'),
        allDay: false,
        ourId: 'rl:0123456789ab:42:7',
      },
    ]);
  });

  it('a gone calendar → missingCalendarIds; the rest still read', async () => {
    const { api, a } = setup();
    busyAt(api, PRIMARY, '03');
    const out = await a.fetchBusy(CREDS, RANGE, ['AAMkADgone=', PRIMARY]);
    expect(out.missingCalendarIds).toEqual(['AAMkADgone=']);
    expect(out.blocks).toHaveLength(1);
  });

  it('an access-denied calendar → unreadableCalendarIds; the rest still read', async () => {
    const { api, a } = setup();
    api.addCalendar('AAMkADshared=', 'Shared', false);
    busyAt(api, PRIMARY, '03');
    api.failNext('denied');
    const out = await a.fetchBusy(CREDS, RANGE, ['AAMkADshared=', PRIMARY]);
    expect(out.unreadableCalendarIds).toEqual(['AAMkADshared=']);
    expect(out.blocks).toHaveLength(1);
  });

  it('every calendar refused → rejects instead of returning zero blocks', async () => {
    const { api, a } = setup();
    api.failNext('denied');
    await expect(a.fetchBusy(CREDS, RANGE, [PRIMARY])).rejects.toBeInstanceOf(
      TransientError,
    );
  });

  it.each([
    ['auth', ProviderAuthError],
    ['rate', RateLimitError],
    ['transient', TransientError],
  ] as const)(
    'a %s failure rejects with the shared error class',
    async (kind, cls) => {
      const { api, a } = setup();
      api.failNext(kind);
      await expect(a.fetchBusy(CREDS, RANGE, [PRIMARY])).rejects.toBeInstanceOf(
        cls,
      );
    },
  );

  it('a 429 carries Retry-After (seconds) as retryAfterMs', async () => {
    const { api, a } = setup();
    api.failNext('rate');
    await expect(a.fetchBusy(CREDS, RANGE, [PRIMARY])).rejects.toMatchObject({
      retryAfterMs: 2000,
    });
  });

  it('T12: every read sends Prefer UTC + ImmutableId and the pinned $select', async () => {
    const { api, a } = setup();
    await a.listCalendars(CREDS);
    await a.fetchBusy(CREDS, RANGE, [PRIMARY]);
    expect(api.requests).toHaveLength(2);
    for (const r of api.requests) {
      expect(r.prefer).toEqual([PREFER_UTC, PREFER_IMMUTABLE_ID]);
      expect(r.accessToken).toBe('fake-graph-access');
    }
    expect(api.requests[1]?.url).toContain(
      `&$select=${MICROSOFT_EVENTS_SELECT}&`,
    );
  });

  it('T11 / item 1: listCalendars follows @odata.nextLink, never trusting $top', async () => {
    const { api, a } = setup();
    api.pageSize = 1;
    api.addCalendar('AAMkADtwo=', 'Two');
    api.addCalendar('AAMkADthree=', 'Three');
    const rows = await a.listCalendars(CREDS);
    expect(rows.map((r) => r.id)).toEqual([
      PRIMARY,
      'AAMkADtwo=',
      'AAMkADthree=',
    ]);
    expect(api.requests).toHaveLength(3);
  });

  it('T11: follows @odata.nextLink across pages', async () => {
    const { api, a } = setup();
    api.pageSize = 1;
    ['03', '04', '05'].forEach((d) => busyAt(api, PRIMARY, d));
    const out = await a.fetchBusy(CREDS, RANGE, [PRIMARY]);
    expect(out.blocks.map((b) => b.start)).toEqual([
      at('03T18:00'),
      at('04T18:00'),
      at('05T18:00'),
    ]);
    expect(api.requests.map((r) => r.url.includes('$skiptoken='))).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('T11: stops at the page cap and warns', async () => {
    const { api, a } = setup();
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    api.pageSize = 1;
    for (let d = 10; d < 22; d += 1) busyAt(api, PRIMARY, String(d));
    const out = await a.fetchBusy(CREDS, RANGE, [PRIMARY]);
    expect(out.blocks).toHaveLength(10);
    expect(warn).toHaveBeenCalledWith(
      'Graph read hit the page cap on 1 calendar(s)',
    );
  });
});
