/**
 * ROK-1593 B2 — pure away-day derivation (epic ROK-669 §4.6). One case per
 * §4.6 edge plus the mode, template, coverage, Q16 and Q-D rules. Persistence
 * (diff-upsert, stable ids) is B3's; the pipeline proof is B5's.
 *
 * Calendar used (2026): Mon 19 Oct … Sun 25 Oct (EDT, UTC-4). DST: US spring
 * forward Sun 8 Mar (02:00 → 03:00), fall back Sun 1 Nov (02:00 → 01:00).
 * Template `dayOfWeek` is the table's 0 = Monday convention.
 */
import {
  deriveAwayRanges,
  expandDateRange,
  type AwayDeriveBlock,
  type AwayDeriveInput,
  type AwayTemplateHour,
  type DerivedAwayRange,
} from './calendar-away-derive.helpers';
import { buildReadWindow } from './calendar-read-normalize.helpers';

const NY = 'America/New_York';
const MON = 0;
const WED = 2;
const FRI = 4;
const SAT = 5;
const SUN = 6;

/** NY week Mon 19 Oct 00:00 → Mon 26 Oct 00:00 local. */
const OCT_WEEK = buildReadWindow(new Date('2026-10-19T12:00:00Z'), NY, 7);

function timed(
  connectionId: number,
  start: string,
  end: string,
): AwayDeriveBlock {
  return {
    connectionId,
    startsAt: new Date(start),
    endsAt: new Date(end),
    allDay: false,
    firstDate: null,
    lastDate: null,
  };
}

function allDay(
  connectionId: number,
  first: string,
  last: string,
): AwayDeriveBlock {
  return {
    connectionId,
    startsAt: new Date(`${first}T00:00:00Z`),
    endsAt: new Date(Date.parse(`${last}T00:00:00Z`) + 24 * 60 * 60 * 1000),
    allDay: true,
    firstDate: first,
    lastDate: last,
  };
}

function hours(dayOfWeek: number, ...startHours: number[]): AwayTemplateHour[] {
  return startHours.map((startHour) => ({ dayOfWeek, startHour }));
}

function derive(overrides: Partial<AwayDeriveInput>): DerivedAwayRange[] {
  return deriveAwayRanges({
    blocks: [],
    mode: 'both',
    templateHours: [],
    timeZone: NY,
    window: OCT_WEEK,
    ignoredDates: [],
    manualDates: [],
    ...overrides,
  });
}

function range(
  startDate: string,
  endDate: string,
  calendarConnectionId: number,
): DerivedAwayRange {
  return { startDate, endDate, calendarConnectionId };
}

describe('deriveAwayRanges — Rule A (all-day)', () => {
  it('marks the provider-stated dates of an all-day block as away', () => {
    const result = derive({ blocks: [allDay(3, '2026-10-21', '2026-10-21')] });
    expect(result).toEqual([range('2026-10-21', '2026-10-21', 3)]);
  });

  it('clips an all-day block spanning the window start to the window', () => {
    const result = derive({ blocks: [allDay(3, '2026-10-15', '2026-10-20')] });
    expect(result).toEqual([range('2026-10-19', '2026-10-20', 3)]);
  });

  it('never shifts all-day dates through the user zone', () => {
    const auckland = 'Pacific/Auckland';
    const result = derive({
      blocks: [allDay(3, '2026-10-21', '2026-10-21')],
      timeZone: auckland,
      window: buildReadWindow(new Date('2026-10-19T12:00:00Z'), auckland, 7),
    });
    expect(result).toEqual([range('2026-10-21', '2026-10-21', 3)]);
  });

  it('merges consecutive dates into one range attributed to the lowest id', () => {
    const result = derive({
      blocks: [
        allDay(5, '2026-10-21', '2026-10-22'),
        allDay(2, '2026-10-23', '2026-10-23'),
        allDay(9, '2026-10-25', '2026-10-25'),
      ],
    });
    expect(result).toEqual([
      range('2026-10-21', '2026-10-23', 2),
      range('2026-10-25', '2026-10-25', 9),
    ]);
  });
});

describe('deriveAwayRanges — Rule B (fully booked game time)', () => {
  it('a 23:00 template hour is covered by a block ending 00:30 next day', () => {
    // Fri 23 Oct 22:00 EDT → Sat 24 Oct 00:30 EDT.
    const result = derive({
      templateHours: hours(FRI, 23),
      blocks: [timed(1, '2026-10-24T02:00:00Z', '2026-10-24T04:30:00Z')],
    });
    expect(result).toEqual([range('2026-10-23', '2026-10-23', 1)]);
  });

  it('a 23:00 template hour is NOT covered by a block ending 23:45', () => {
    const result = derive({
      templateHours: hours(FRI, 23),
      blocks: [timed(1, '2026-10-24T02:00:00Z', '2026-10-24T03:45:00Z')],
    });
    expect(result).toEqual([]);
  });

  it('a Fri 18:00 → Sun 12:00 block covers Friday and Saturday game time', () => {
    const result = derive({
      templateHours: [
        ...hours(FRI, 19, 20, 21),
        ...hours(SAT, 19, 20, 21),
        ...hours(SUN, 19, 20, 21),
      ],
      blocks: [timed(1, '2026-10-23T22:00:00Z', '2026-10-25T16:00:00Z')],
    });
    // Sunday's 19–21 is after the block ends → not away.
    expect(result).toEqual([range('2026-10-23', '2026-10-24', 1)]);
  });

  it('partial coverage of the template hours is not away', () => {
    // Wed 21 Oct 19:00–21:00 EDT leaves the 21:00 hour free.
    const result = derive({
      templateHours: hours(WED, 19, 20, 21),
      blocks: [timed(1, '2026-10-21T23:00:00Z', '2026-10-22T01:00:00Z')],
    });
    expect(result).toEqual([]);
  });

  it('no template for that weekday → Rule B never fires', () => {
    // Template only on Monday; Tuesday is booked solid.
    const result = derive({
      templateHours: hours(MON, 20),
      blocks: [timed(1, '2026-10-20T04:00:00Z', '2026-10-21T04:00:00Z')],
    });
    expect(result).toEqual([]);
  });

  it('two connections’ adjacent blocks together cover → away, lowest contributing id (Q16)', () => {
    const result = derive({
      templateHours: hours(WED, 19, 20, 21),
      blocks: [
        // Wed 08:00–09:00 EDT: outside game time, so it does not contribute.
        timed(1, '2026-10-21T12:00:00Z', '2026-10-21T13:00:00Z'),
        timed(7, '2026-10-21T23:00:00Z', '2026-10-22T00:00:00Z'),
        timed(4, '2026-10-22T00:00:00Z', '2026-10-22T02:00:00Z'),
      ],
    });
    expect(result).toEqual([range('2026-10-21', '2026-10-21', 4)]);
  });

  it('either connection alone does not cover the evening', () => {
    const result = derive({
      templateHours: hours(WED, 19, 20, 21),
      blocks: [timed(7, '2026-10-21T23:00:00Z', '2026-10-22T00:00:00Z')],
    });
    expect(result).toEqual([]);
  });
});

describe('deriveAwayRanges — DST days', () => {
  const MAR_8 = buildReadWindow(new Date('2026-03-08T12:00:00Z'), NY, 1);
  const NOV_1 = buildReadWindow(new Date('2026-11-01T12:00:00Z'), NY, 1);

  it('spring forward (23 h day): 01:00–04:00 local covers hours 1, 2 (gap) and 3', () => {
    // 06:00Z = 01:00 EST, 08:00Z = 04:00 EDT.
    const result = derive({
      window: MAR_8,
      templateHours: hours(SUN, 1, 2, 3),
      blocks: [timed(1, '2026-03-08T06:00:00Z', '2026-03-08T08:00:00Z')],
    });
    expect(result).toEqual([range('2026-03-08', '2026-03-08', 1)]);
  });

  it('spring forward: the 01:00 hour is one real hour, not trivially covered', () => {
    // 00:30–01:00 EST touches the hour's start but does not cover it.
    const result = derive({
      window: MAR_8,
      templateHours: hours(SUN, 1),
      blocks: [timed(1, '2026-03-08T05:30:00Z', '2026-03-08T06:00:00Z')],
    });
    expect(result).toEqual([]);
  });

  it('spring forward: missing the 03:00 hour is not away', () => {
    const result = derive({
      window: MAR_8,
      templateHours: hours(SUN, 1, 2, 3),
      blocks: [timed(1, '2026-03-08T06:00:00Z', '2026-03-08T07:30:00Z')],
    });
    expect(result).toEqual([]);
  });

  it('fall back (25 h day): the repeated 01:00 hour needs both real hours', () => {
    // 05:00Z = first 01:00 EDT; 06:00Z = second 01:00 EST; 07:00Z = 02:00 EST.
    const firstOnly = derive({
      window: NOV_1,
      templateHours: hours(SUN, 1),
      blocks: [timed(1, '2026-11-01T05:00:00Z', '2026-11-01T06:00:00Z')],
    });
    const both = derive({
      window: NOV_1,
      templateHours: hours(SUN, 1),
      blocks: [timed(1, '2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z')],
    });
    expect(firstOnly).toEqual([]);
    expect(both).toEqual([range('2026-11-01', '2026-11-01', 1)]);
  });
});

describe('deriveAwayRanges — timezone change between runs', () => {
  it('re-derives against the new zone: the same block is away in one zone only', () => {
    // 00:00–01:00Z Thu 22 Oct = Wed 20:00 EDT, but Thu 01:00 BST in London.
    const input = {
      templateHours: hours(WED, 20),
      blocks: [timed(1, '2026-10-22T00:00:00Z', '2026-10-22T01:00:00Z')],
    };
    const london = 'Europe/London';
    const inNewYork = derive(input);
    const inLondon = derive({
      ...input,
      timeZone: london,
      window: buildReadWindow(new Date('2026-10-19T12:00:00Z'), london, 7),
    });
    expect(inNewYork).toEqual([range('2026-10-21', '2026-10-21', 1)]);
    expect(inLondon).toEqual([]);
  });
});

describe('deriveAwayRanges — read mode', () => {
  const input = {
    templateHours: hours(WED, 20),
    blocks: [
      allDay(2, '2026-10-19', '2026-10-19'),
      timed(1, '2026-10-22T00:00:00Z', '2026-10-22T01:00:00Z'),
    ],
  };

  it('mode `hours` derives no away days', () => {
    expect(derive({ ...input, mode: 'hours' })).toEqual([]);
  });

  it('mode `days` derives exactly what `both` derives', () => {
    const both = derive({ ...input, mode: 'both' });
    expect(both).toEqual([
      range('2026-10-19', '2026-10-19', 2),
      range('2026-10-21', '2026-10-21', 1),
    ]);
    expect(derive({ ...input, mode: 'days' })).toEqual(both);
  });
});

describe('deriveAwayRanges — subtraction', () => {
  const blocks = [allDay(1, '2026-10-21', '2026-10-23')];

  it('removes ignored dates and splits the range around them', () => {
    const result = derive({ blocks, ignoredDates: ['2026-10-22'] });
    expect(result).toEqual([
      range('2026-10-21', '2026-10-21', 1),
      range('2026-10-23', '2026-10-23', 1),
    ]);
  });

  it('never creates a synced day inside a manual absence (Q-D)', () => {
    const result = derive({
      blocks,
      manualDates: expandDateRange('2026-10-22', '2026-10-30'),
    });
    expect(result).toEqual([range('2026-10-21', '2026-10-21', 1)]);
  });
});

describe('expandDateRange', () => {
  it('lists every date inclusive, across a month boundary', () => {
    expect(expandDateRange('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
  });
});
