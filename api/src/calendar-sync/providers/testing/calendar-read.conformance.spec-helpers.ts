import type {
  CalendarCredentials,
  CalendarReadCapability,
  CalendarWriteCapability,
  CopyEventInput,
  TimeRange,
} from '../calendar-provider.interface';
import {
  ProviderAuthError,
  RateLimitError,
  TransientError,
} from '../calendar-provider.errors';

/**
 * ROK-1593 (spec §6 row A4): the read half of the calendar provider
 * conformance suite. The factory runs before EACH case and stages what the
 * adapter needs (a real adapter: an in-memory API behind its HTTP seam).
 * Read must return what the SAME provider's write path stored, so the
 * copy round-trip below is real, not a fixture. Copy ids use a real
 * 12-hex instance so every adapter's copy-id parser accepts them.
 */
export interface ReadConformanceHarness {
  provider: CalendarReadCapability & CalendarWriteCapability;
  credentials: CalendarCredentials;
  /** A foreign (not Raid Ledger) event; `busy: false` shows as Free. */
  seedEvent(
    calendarId: string,
    event: { start: Date; end: Date; busy: boolean },
  ): void | Promise<void>;
  /** The next read request fails as `kind`. */
  failNextRead(kind: 'auth' | 'rate' | 'transient'): void;
  /** The user's main calendar id; `primary` (fake, Google) when absent (ROK-1598 A5). */
  primaryCalendarId?: string;
}

export type ReadConformanceFactory = () =>
  ReadConformanceHarness | Promise<ReadConformanceHarness>;

type ReadHarness = () => ReadConformanceHarness;

/** The fake and Google expose the user's main calendar as `primary`; Apple names it. */
const primaryOf = (h: ReadConformanceHarness) =>
  h.primaryCalendarId ?? 'primary';
const RANGE: TimeRange = {
  start: new Date('2026-11-01T00:00:00.000Z'),
  end: new Date('2026-11-29T00:00:00.000Z'),
};
const at = (iso: string) => new Date(`2026-11-${iso}:00.000Z`);
const COPY: CopyEventInput = {
  copyId: 'rl:0123456789ab:42:7',
  title: 'Raid Night',
  description: 'https://raid.example/events/42',
  url: 'https://raid.example/events/42',
  start: at('05T19:00'),
  end: at('05T22:00'),
  tentative: false,
};

function describeCalendars(get: ReadHarness): void {
  it('listCalendars lists primary and the dedicated calendar (caller flags isRaidLedger)', async () => {
    const h = get();
    const id = await h.provider.ensureRaidLedgerCalendar(h.credentials, null);
    const rows = await h.provider.listCalendars(h.credentials);
    expect(rows.find((r) => r.id === primaryOf(h))).toMatchObject({
      primary: true,
      isRaidLedger: false,
    });
    expect(rows.find((r) => r.id === id)).toMatchObject({
      primary: false,
      writable: true,
      isRaidLedger: false,
    });
  });
}

function describeBusy(get: ReadHarness): void {
  it('fetchBusy returns [start, end) blocks, drops Free events and those outside the range', async () => {
    const h = get();
    await h.seedEvent(primaryOf(h), {
      start: at('03T18:00'),
      end: at('03T20:00'),
      busy: true,
    });
    await h.seedEvent(primaryOf(h), {
      start: at('04T18:00'),
      end: at('04T20:00'),
      busy: false,
    });
    await h.seedEvent(primaryOf(h), {
      start: new Date('2026-12-10T18:00:00.000Z'),
      end: new Date('2026-12-10T19:00:00.000Z'),
      busy: true,
    });
    const out = await h.provider.fetchBusy(h.credentials, RANGE, [
      primaryOf(h),
    ]);
    expect(out.blocks).toEqual([
      { start: at('03T18:00'), end: at('03T20:00'), allDay: false },
    ]);
    expect(out.missingCalendarIds ?? []).toEqual([]);
  });

  it('round-trip: a busy copy this provider wrote reads back with ourId; a tentative one is Free', async () => {
    const h = get();
    const cal = await h.provider.ensureRaidLedgerCalendar(h.credentials, null);
    await h.provider.upsertEvent(h.credentials, cal, COPY, null);
    const maybe = {
      ...COPY,
      copyId: 'rl:0123456789ab:43:7',
      tentative: true,
    };
    await h.provider.upsertEvent(h.credentials, cal, maybe, null);
    const out = await h.provider.fetchBusy(h.credentials, RANGE, [cal]);
    expect(out.blocks).toEqual([
      { start: COPY.start, end: COPY.end, allDay: false, ourId: COPY.copyId },
    ]);
  });

  it('a calendar that is gone is reported in missingCalendarIds; the rest still read', async () => {
    const h = get();
    await h.seedEvent(primaryOf(h), {
      start: at('03T18:00'),
      end: at('03T20:00'),
      busy: true,
    });
    const out = await h.provider.fetchBusy(h.credentials, RANGE, [
      'gone-cal',
      primaryOf(h),
    ]);
    expect(out.missingCalendarIds).toEqual(['gone-cal']);
    expect(out.blocks).toHaveLength(1);
  });
}

function describeReadErrors(get: ReadHarness): void {
  it.each([
    ['auth', ProviderAuthError],
    ['rate', RateLimitError],
    ['transient', TransientError],
  ] as const)(
    'a %s failure rejects with the shared error class',
    async (kind, cls) => {
      const h = get();
      h.failNextRead(kind);
      await expect(
        h.provider.fetchBusy(h.credentials, RANGE, [primaryOf(h)]),
      ).rejects.toBeInstanceOf(cls);
    },
  );
}

/** Register the read conformance suite for one adapter (ROK-1593). */
export function describeCalendarReadConformance(
  factory: ReadConformanceFactory,
  name = 'adapter',
): void {
  describe(`${name} — calendar read conformance`, () => {
    let harness: ReadConformanceHarness;
    beforeEach(async () => {
      harness = await factory();
    });
    const get: ReadHarness = () => harness;
    describeCalendars(get);
    describeBusy(get);
    describeReadErrors(get);
  });
}
