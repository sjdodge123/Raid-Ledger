/**
 * ROK-1593 A5 — pure read normalisation (epic §4.4.2 step 6): R2 by
 * instance, clip to the window, merge per all-day class, all-day bounds from
 * the user's local dates. Persistence is proven by the pipeline integration
 * spec (A9).
 */
import * as eventsMixed from '../providers/google/__fixtures__/events-mixed.json';
import { normalizeGoogleEvent } from '../providers/google/google-calendar-read.helpers';
import type { BusyBlock } from '../providers/calendar-provider.interface';
import {
  buildReadWindow,
  isOwnCopy,
  normalizeBusyBlocks,
  type NormalizedBusyBlock,
  type ReadWindow,
} from './calendar-read-normalize.helpers';

const OURS = '0123456789ab';
const FOREIGN = 'fedcba987654';
const NY = 'America/New_York';

/** Window in UTC: 2026-10-20 00:00Z → 2026-10-27 00:00Z (7 days). */
const UTC_WINDOW: ReadWindow = buildReadWindow(
  new Date('2026-10-20T15:00:00Z'),
  'UTC',
  7,
);

function timed(start: string, end: string, ourId?: string): BusyBlock {
  const block = { start: new Date(start), end: new Date(end), allDay: false };
  return ourId === undefined ? block : { ...block, ourId };
}

function allDay(first: string, lastInclusive: string): BusyBlock {
  return {
    start: new Date(`${first}T00:00:00Z`),
    end: new Date(`${lastInclusive}T00:00:00Z`),
    allDay: true,
    allDayDates: { first, lastInclusive },
  };
}

function run(blocks: BusyBlock[], window: ReadWindow = UTC_WINDOW) {
  return normalizeBusyBlocks(blocks, { instanceId: OURS, window });
}

function iso(rows: NormalizedBusyBlock[]): string[][] {
  return rows.map((r) => [r.startsAt.toISOString(), r.endsAt.toISOString()]);
}

describe('buildReadWindow', () => {
  it('starts at local midnight and ends after N local days, across DST', () => {
    // 03:00Z on the 20th is still the 19th (23:00 EDT) in New York.
    const w = buildReadWindow(new Date('2026-10-20T03:00:00Z'), NY, 28);
    expect(w.firstDate).toBe('2026-10-19');
    expect(w.lastDate).toBe('2026-11-15');
    expect(w.start.toISOString()).toBe('2026-10-19T04:00:00.000Z');
    // DST ends 2026-11-01: the end midnight is EST (UTC-5).
    expect(w.end.toISOString()).toBe('2026-11-16T05:00:00.000Z');
  });
});

describe('normalizeBusyBlocks — R2 by instance', () => {
  it('drops a copy stamped by this instance', () => {
    const own = timed(
      '2026-10-21T19:00:00Z',
      '2026-10-21T22:00:00Z',
      `rl:${OURS}:42:7`,
    );
    expect(isOwnCopy(own, OURS)).toBe(true);
    expect(run([own])).toEqual([]);
  });

  it('keeps a copy stamped by a foreign instance', () => {
    const foreign = timed(
      '2026-10-21T19:00:00Z',
      '2026-10-21T21:00:00Z',
      `rl:${FOREIGN}:9:3`,
    );
    expect(isOwnCopy(foreign, OURS)).toBe(false);
    expect(iso(run([foreign]))).toEqual([
      ['2026-10-21T19:00:00.000Z', '2026-10-21T21:00:00.000Z'],
    ]);
  });

  it('drops transparent + own copy and keeps the foreign copy on the Google fixture', () => {
    const blocks = eventsMixed.items
      .map((item) => normalizeGoogleEvent(item, null))
      .filter((b): b is BusyBlock => b !== null);
    const window = buildReadWindow(new Date('2026-10-19T12:00:00Z'), 'UTC', 14);
    const rows = iso(run(blocks, window)).map(([s]) => s);
    // Transparent 2026-10-21 12:00Z and our copy 2026-10-28 19:00Z: gone.
    expect(rows).not.toContain('2026-10-21T12:00:00.000Z');
    expect(rows).not.toContain('2026-10-28T19:00:00.000Z');
    // The foreign-instance copy on 2026-10-29 counts as busy.
    expect(rows).toContain('2026-10-29T19:00:00.000Z');
  });
});

describe('normalizeBusyBlocks — clip to the window', () => {
  it('clips a timed block at the window start', () => {
    const rows = run([timed('2026-10-19T22:00:00Z', '2026-10-20T02:00:00Z')]);
    expect(iso(rows)).toEqual([
      ['2026-10-20T00:00:00.000Z', '2026-10-20T02:00:00.000Z'],
    ]);
  });

  it('clips a timed block at the window end', () => {
    const rows = run([timed('2026-10-26T23:00:00Z', '2026-10-27T03:00:00Z')]);
    expect(iso(rows)).toEqual([
      ['2026-10-26T23:00:00.000Z', '2026-10-27T00:00:00.000Z'],
    ]);
  });

  it('drops blocks wholly outside the window (end is exclusive)', () => {
    const rows = run([
      timed('2026-10-19T10:00:00Z', '2026-10-20T00:00:00Z'),
      timed('2026-10-27T00:00:00Z', '2026-10-27T05:00:00Z'),
      allDay('2026-10-27', '2026-10-30'),
    ]);
    expect(rows).toEqual([]);
  });

  it('clips an all-day range by dates at both window edges', () => {
    const rows = run([allDay('2026-10-15', '2026-10-30')]);
    expect(rows).toEqual([
      {
        startsAt: new Date('2026-10-20T00:00:00Z'),
        endsAt: new Date('2026-10-27T00:00:00Z'),
        allDay: true,
        firstDate: '2026-10-20',
        lastDate: '2026-10-26',
      },
    ]);
  });
});

describe('normalizeBusyBlocks — merge per all-day class', () => {
  it('merges overlapping and touching timed blocks, keeps a gap apart', () => {
    const rows = run([
      timed('2026-10-21T18:00:00Z', '2026-10-21T20:00:00Z'),
      timed('2026-10-21T19:00:00Z', '2026-10-21T21:00:00Z'),
      timed('2026-10-21T21:00:00Z', '2026-10-21T22:00:00Z'),
      timed('2026-10-21T23:00:00Z', '2026-10-21T23:30:00Z'),
    ]);
    expect(iso(rows)).toEqual([
      ['2026-10-21T18:00:00.000Z', '2026-10-21T22:00:00.000Z'],
      ['2026-10-21T23:00:00.000Z', '2026-10-21T23:30:00.000Z'],
    ]);
  });

  it('merges overlapping all-day ranges into one date range', () => {
    const rows = run([
      allDay('2026-10-21', '2026-10-22'),
      allDay('2026-10-22', '2026-10-24'),
    ]);
    expect(rows.map((r) => [r.firstDate, r.lastDate])).toEqual([
      ['2026-10-21', '2026-10-24'],
    ]);
  });

  it('keeps an all-day block separate from a timed block on the same day', () => {
    const rows = run([
      allDay('2026-10-22', '2026-10-22'),
      timed('2026-10-22T10:00:00Z', '2026-10-22T12:00:00Z'),
    ]);
    expect(rows.map((r) => r.allDay)).toEqual([false, true]);
    expect(iso(rows)).toEqual([
      ['2026-10-22T10:00:00.000Z', '2026-10-22T12:00:00.000Z'],
      ['2026-10-22T00:00:00.000Z', '2026-10-23T00:00:00.000Z'],
    ]);
  });
});

describe('normalizeBusyBlocks — all-day bounds come from local dates', () => {
  it('stores the user-local midnights, not the adapter UTC instants', () => {
    const w = buildReadWindow(new Date('2026-10-20T12:00:00Z'), NY, 14);
    const rows = run([allDay('2026-10-27', '2026-10-28')], w);
    expect(rows).toEqual([
      {
        startsAt: new Date('2026-10-27T04:00:00Z'),
        endsAt: new Date('2026-10-29T04:00:00Z'),
        allDay: true,
        firstDate: '2026-10-27',
        lastDate: '2026-10-28',
      },
    ]);
  });

  it('drops an all-day block without valid dates', () => {
    const bad: BusyBlock = {
      start: new Date('2026-10-22T00:00:00Z'),
      end: new Date('2026-10-23T00:00:00Z'),
      allDay: true,
    };
    const garbled = { ...bad, allDayDates: { first: 'x', lastInclusive: 'y' } };
    expect(run([bad, garbled])).toEqual([]);
  });
});
