/**
 * ROK-1598 D7 — the read cursor round-trip and the Apple `primary` alias.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../../common/testing/drizzle-mock';
import type * as schema from '../../drizzle/schema';
import { _resetKeyCache } from '../../settings/encryption.util';
import type {
  CalendarCredentials,
  FetchBusyResult,
  ProviderCalendar,
  TimeRange,
} from '../providers/calendar-provider.interface';
import { encryptCalendarCredentials } from '../services/calendar-credentials.helpers';
import type { ReadWindow } from './calendar-read-normalize.helpers';
import {
  cursorFields,
  isCursor,
  resolvePrimaryAlias,
  withEligiblePrimary,
  storedCursor,
  unchangedStillValid,
} from './calendar-read-cursor.helpers';
import { buildSyncedFields, fetchWindow } from './calendar-read-sync.helpers';
import { toProviderCalendars } from '../providers/apple/apple-read.helpers';

const NOW = new Date('2026-10-20T12:00:00Z');
const stamp = { now: NOW, random: () => 0.5 };
const CURSOR = {
  w: '2026-10-20T00:00:00.000Z/2026-11-17T00:00:00.000Z',
  'c:home': '7',
};

function cal(
  id: string,
  primary = false,
  isRaidLedger = false,
): ProviderCalendar {
  return { id, name: id, primary, writable: true, isRaidLedger };
}

describe('storedCursor (jsonb guard)', () => {
  it('passes a flat string map through', () => {
    expect(storedCursor(CURSOR)).toEqual(CURSOR);
    expect(isCursor({})).toBe(true);
  });

  it.each([
    null,
    undefined,
    'w',
    42,
    ['a'],
    { w: 1 },
    { 'c:home': { x: '1' } },
  ])('treats %p as no cursor', (raw) => {
    expect(storedCursor(raw)).toBeUndefined();
  });
});

describe('buildSyncedFields cursor', () => {
  const locked = { readCalendarIds: [] };

  it('saves the cursor the provider returned', () => {
    const fields = buildSyncedFields(locked, { cursor: CURSOR }, stamp);
    expect(fields.syncCursor).toEqual(CURSOR);
  });

  it('leaves sync_cursor alone when the provider sent none (Google)', () => {
    const fields = buildSyncedFields(locked, {}, stamp);
    expect('syncCursor' in fields).toBe(false);
    expect(cursorFields(undefined)).toEqual({});
  });
});

describe('resolvePrimaryAlias', () => {
  const listed = [cal('work'), cal('home', true), cal('rl-x', false, true)];

  it('Apple: primary becomes the listed primary calendar, deduplicated', () => {
    expect(resolvePrimaryAlias('apple', ['primary'], listed)).toEqual(['home']);
    expect(
      resolvePrimaryAlias('apple', ['home', 'primary', 'work'], listed),
    ).toEqual(['home', 'work']);
  });

  it('Apple with no primary listed reads nothing for the alias', () => {
    expect(resolvePrimaryAlias('apple', ['primary'], [cal('work')])).toEqual(
      [],
    );
  });

  it('Apple: a dedicated calendar flagged primary (no home) → the default reads work', () => {
    const noHome = [cal('raid-ledger-x', true), cal('work')];
    const excluded = new Set(['raid-ledger-x']);
    expect(resolvePrimaryAlias('apple', ['primary'], noHome, excluded)).toEqual(
      ['work'],
    );
    expect(
      resolvePrimaryAlias('apple', ['raid-ledger-x', 'work'], noHome, excluded),
    ).toEqual(['work']);
  });

  it('Google keeps the literal primary (the API resolves it)', () => {
    expect(resolvePrimaryAlias('google', ['primary', 'x'], listed)).toEqual([
      'primary',
      'x',
    ]);
  });
});

describe('withEligiblePrimary — picker primary vs. the dedicated exclusion (Codex r3)', () => {
  const col = (id: string) => ({
    id,
    href: `/123/calendars/${id}/`,
    displayName: id,
    components: ['VEVENT'],
    ctag: null,
    writable: true,
    timezone: null,
  });
  // No `home`; the dedicated calendar sorts first by href → flagged primary.
  const listed = toProviderCalendars([col('work'), col('a-raid-ledger')]);
  const picker = listed.map((c) => ({
    ...c,
    isRaidLedger: c.id === 'a-raid-ledger',
  }));

  it('Apple: the flag moves to the calendar the default selection reads', () => {
    expect(listed.find((c) => c.primary)?.id).toBe('a-raid-ledger');
    const rows = withEligiblePrimary('apple', picker);
    expect(rows.filter((c) => c.primary).map((c) => c.id)).toEqual(['work']);
    const excluded = new Set(['a-raid-ledger']);
    expect(resolvePrimaryAlias('apple', ['primary'], rows, excluded)).toEqual([
      'work',
    ]);
  });

  it('Apple with an eligible primary keeps it; Google is untouched', () => {
    const home = [cal('home', true), cal('rl-x', false, true), cal('a')];
    expect(withEligiblePrimary('apple', home)).toEqual(home);
    const google = [cal('rl-x', true, true), cal('a')];
    expect(withEligiblePrimary('google', google)).toEqual(google);
  });
});

describe('fetchWindow passes the stored cursor (D7 wiring)', () => {
  const ORIGINAL_SECRET = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = 'calendar-read-cursor-spec-secret';
    _resetKeyCache();
  });
  afterAll(() => {
    process.env.JWT_SECRET = ORIGINAL_SECRET;
    _resetKeyCache();
  });

  const db = createDrizzleMock() as unknown as PostgresJsDatabase<
    typeof schema
  >;
  const window: ReadWindow = {
    start: new Date('2026-10-20T00:00:00Z'),
    end: new Date('2026-11-17T00:00:00Z'),
    firstDate: '2026-10-20',
    lastDate: '2026-11-16',
    timeZone: 'UTC',
  };

  function stub() {
    const fetchBusy = jest.fn<
      Promise<FetchBusyResult>,
      [CalendarCredentials, TimeRange, string[], Record<string, string>?]
    >(() => Promise.resolve({ blocks: [] }));
    const provider = {
      key: 'apple' as const,
      listCalendars: () => Promise.resolve([cal('home', true)]),
      fetchBusy,
      refresh: () => Promise.reject(new Error('caldav never refreshes')),
    };
    return { provider, fetchBusy };
  }

  function conn(syncCursor: unknown) {
    const creds: CalendarCredentials = {
      kind: 'caldav',
      username: 'u@icloud.example',
      appPassword: 'x',
    };
    return {
      id: 1,
      userId: 2,
      credentialsEncrypted: encryptCalendarCredentials(creds),
      readCalendarIds: [],
      dedicatedCalendarId: null,
      syncCursor,
    };
  }

  it('hands the stored cursor to fetchBusy, primary resolved to home', async () => {
    const { provider, fetchBusy } = stub();
    await fetchWindow({ db, provider }, conn(CURSOR), window);
    expect(fetchBusy.mock.calls[0]?.slice(1)).toEqual([
      { start: window.start, end: window.end },
      ['home'],
      CURSOR,
    ]);
  });

  it('a malformed stored cursor goes in as undefined (full read)', async () => {
    const { provider, fetchBusy } = stub();
    await fetchWindow({ db, provider }, conn({ w: 3 }), window);
    expect(fetchBusy.mock.calls[0]?.slice(2)).toEqual([['home'], undefined]);
  });

  it('Codex r5: no resolvable calendar → empty blocks AND an emptied cursor', async () => {
    const { provider, fetchBusy } = stub();
    provider.listCalendars = () => Promise.resolve([]);
    const result = await fetchWindow({ db, provider }, conn(CURSOR), window);
    expect(fetchBusy).not.toHaveBeenCalled();
    expect(result).toEqual({ blocks: [], cursor: {} });
    const stamp = { now: NOW, random: () => 0 };
    expect(buildSyncedFields({ readCalendarIds: [] }, result, stamp)).toEqual(
      expect.objectContaining({ syncCursor: {} }),
    );
  });

  it('collections raid-ledger-x + work, no home → the default read fetches work', async () => {
    const { provider, fetchBusy } = stub();
    provider.listCalendars = () =>
      Promise.resolve([cal('raid-ledger-x', true), cal('work')]);
    const row = { ...conn(undefined), dedicatedCalendarId: 'raid-ledger-x' };
    await fetchWindow({ db, provider }, row, window);
    expect(fetchBusy.mock.calls[0]?.[2]).toEqual(['work']);
  });
});

describe('unchangedStillValid — re-checked under the commit lock (Codex r7)', () => {
  it('honours `unchanged` when the locked cursor is the one sent (key order aside)', () => {
    const reordered = { 'c:home': '7', w: CURSOR.w };
    expect(unchangedStillValid(CURSOR, reordered)).toBe(true);
  });

  it('a purge cleared the cursor mid-fetch → not valid (full re-read)', () => {
    expect(unchangedStillValid(CURSOR, null)).toBe(false);
  });

  it('another sync advanced the cursor mid-fetch → not valid', () => {
    expect(unchangedStillValid(CURSOR, { ...CURSOR, 'c:home': '8' })).toBe(
      false,
    );
    expect(unchangedStillValid(CURSOR, { w: CURSOR.w })).toBe(false);
  });

  it('no cursor was sent → never valid', () => {
    expect(unchangedStillValid(undefined, CURSOR)).toBe(false);
  });
});
