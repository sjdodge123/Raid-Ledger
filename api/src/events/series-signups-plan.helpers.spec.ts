/**
 * Unit tests for the pure series-signup planning helpers (ROK-1728 §6.2).
 * Each case names the bucket / boundary it pins, so a swapped bucket or an
 * off-by-one at the anchor, `now` or the 23h line fails on its own assertion.
 */
import {
  buildSeriesState,
  toLeaveNights,
  classifyNights,
  isLateCancel,
  selectJoinableNights,
  toSeriesSignupDto,
  type JoinableNight,
  type SeriesOccurrence,
  type UserSeriesRow,
} from './series-signups-plan.helpers';
import type { SeriesSignupRow } from './series-signups.queries';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-01T12:00:00.000Z');
const MEMBERSHIP_ID = 7;

/** A Date `h` hours after NOW. */
function at(h: number): Date {
  return new Date(NOW.getTime() + h * HOUR);
}

function occ(eventId: number, h: number, cancelled = false): SeriesOccurrence {
  return { eventId, startTime: at(h), cancelledAt: cancelled ? at(-1) : null };
}

function night(eventId: number, h: number): JoinableNight {
  return { eventId, startTime: at(h) };
}

function row(
  eventId: number,
  status: string,
  seriesSignupId: number | null = null,
): UserSeriesRow {
  return { id: eventId * 100, eventId, status, seriesSignupId };
}

function membershipRow(
  overrides: Partial<SeriesSignupRow> = {},
): SeriesSignupRow {
  return {
    id: MEMBERSHIP_ID,
    recurrenceGroupId: '6f1c3c1e-3b7a-4a59-9a39-2a6f9d1b8c11',
    userId: 3,
    characterId: null,
    preferredRoles: ['tank'],
    status: 'active',
    endedReason: null,
    joinedAt: new Date('2026-10-30T10:00:00.000Z'),
    endedAt: null,
    ...overrides,
  };
}

const ids = (xs: { eventId: number }[]): number[] => xs.map((x) => x.eventId);

describe('selectJoinableNights', () => {
  it('keeps the anchor occurrence itself (inclusive boundary) and later ones', () => {
    const result = selectJoinableNights([occ(1, 24), occ(2, 48)], at(24), NOW);
    expect(ids(result)).toEqual([1, 2]);
  });

  it('drops occurrences before the clicked anchor (OQ-9)', () => {
    const result = selectJoinableNights([occ(1, 24), occ(2, 48)], at(48), NOW);
    expect(ids(result)).toEqual([2]);
  });

  it('drops a cancelled occurrence after the anchor', () => {
    const result = selectJoinableNights(
      [occ(1, 24), occ(2, 48, true), occ(3, 72)],
      at(24),
      NOW,
    );
    expect(ids(result)).toEqual([1, 3]);
  });

  it('drops occurrences starting at or before now even when after the anchor', () => {
    const result = selectJoinableNights(
      [occ(1, -2), occ(2, 0), occ(3, 1)],
      at(-48),
      NOW,
    );
    expect(ids(result)).toEqual([3]);
  });

  it('orders by start time and strips cancelledAt', () => {
    const result = selectJoinableNights([occ(2, 48), occ(1, 24)], NOW, NOW);
    expect(result).toEqual([night(1, 24), night(2, 48)]);
  });
});

describe('classifyNights', () => {
  const nights = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => night(id, id * 24));
  const rows = [
    row(2, 'signed_up'),
    row(3, 'tentative'),
    row(4, 'signed_up', MEMBERSHIP_ID),
    row(5, 'tentative', MEMBERSHIP_ID),
    row(6, 'declined'),
    row(7, 'roached_out', MEMBERSHIP_ID),
    row(8, 'departed'),
    row(99, 'signed_up'), // not a joinable night — must be ignored
  ];
  const c = classifyNights(nights, rows, MEMBERSHIP_ID);

  it('puts a night with no row in create', () => {
    expect(ids(c.create)).toEqual([1]);
  });

  it('puts active untagged rows (signed_up, tentative) in attach', () => {
    expect(ids(c.attach)).toEqual([2, 3]);
  });

  it('puts active rows tagged by this membership in inSeries', () => {
    expect(ids(c.inSeries)).toEqual([4, 5]);
  });

  it('puts inactive rows in keep whether tagged or not (D4, AC2c)', () => {
    expect(ids(c.keep)).toEqual([6, 7, 8]);
  });

  it('never attaches an active row tagged by another membership', () => {
    const other = classifyNights([night(1, 24)], [row(1, 'signed_up', 42)]);
    expect({
      attach: ids(other.attach),
      inSeries: ids(other.inSeries),
    }).toEqual({
      attach: [],
      inSeries: [1],
    });
  });
});

describe('buildSeriesState', () => {
  const nights = [night(1, 24), night(2, 48), night(3, 72), night(4, 96)];
  const rows = [
    row(1, 'declined'),
    row(2, 'signed_up'),
    row(4, 'tentative', MEMBERSHIP_ID),
  ];

  it('maps each night to its state and row status', () => {
    const state = buildSeriesState(
      nights,
      classifyNights(nights, rows),
      undefined,
    );
    expect(
      state.nights.map((n) => [n.eventId, n.state, n.signupStatus]),
    ).toEqual([
      [1, 'stays_inactive', 'declined'],
      [2, 'will_attach', 'signed_up'],
      [3, 'will_create', null],
      [4, 'in_series', 'tentative'],
    ]);
  });

  it('counts and spans only joinable nights (kept / in-series excluded)', () => {
    const state = buildSeriesState(
      nights,
      classifyNights(nights, rows),
      undefined,
    );
    expect({
      joinableCount: state.joinableCount,
      firstNight: state.firstNight,
      lastNight: state.lastNight,
    }).toEqual({
      joinableCount: 2,
      firstNight: at(48).toISOString(),
      lastNight: at(72).toISOString(),
    });
  });

  it('returns null span and zero count when nothing is joinable', () => {
    const only = [night(1, 24)];
    const state = buildSeriesState(
      only,
      classifyNights(only, [row(1, 'departed')]),
      undefined,
    );
    expect([state.joinableCount, state.firstNight, state.lastNight]).toEqual([
      0,
      null,
      null,
    ]);
  });

  it('serialises the membership, or null when there is none', () => {
    const none = buildSeriesState([], classifyNights([], []), undefined);
    const some = buildSeriesState([], classifyNights([], []), membershipRow());
    expect([none.membership, some.membership?.id]).toEqual([
      null,
      MEMBERSHIP_ID,
    ]);
  });
});

describe('toSeriesSignupDto', () => {
  it('converts Dates to ISO strings and keeps the enum columns', () => {
    const ended = new Date('2026-11-02T08:00:00.000Z');
    const dto = toSeriesSignupDto(
      membershipRow({
        status: 'left',
        endedReason: 'user_left',
        endedAt: ended,
      }),
    );
    expect(dto).toEqual({
      id: MEMBERSHIP_ID,
      recurrenceGroupId: '6f1c3c1e-3b7a-4a59-9a39-2a6f9d1b8c11',
      userId: 3,
      characterId: null,
      preferredRoles: ['tank'],
      status: 'left',
      endedReason: 'user_left',
      joinedAt: '2026-10-30T10:00:00.000Z',
      endedAt: '2026-11-02T08:00:00.000Z',
    });
  });
});

describe('isLateCancel', () => {
  it('is late at 22h59m before start', () => {
    expect(
      isLateCancel(new Date(NOW.getTime() + 22 * HOUR + 59 * 60 * 1000), NOW),
    ).toBe(true);
  });

  it('is NOT late at exactly 23h before start (same >= 23 rule as determineCancelStatus)', () => {
    expect(isLateCancel(at(23), NOW)).toBe(false);
  });
});

describe('toLeaveNights', () => {
  it('lists the tagged nights earliest first as ISO starts', () => {
    expect(
      toLeaveNights([
        { eventId: 9, startTime: at(96) },
        { eventId: 4, startTime: at(5) },
      ]),
    ).toEqual([
      { eventId: 4, startTime: at(5).toISOString() },
      { eventId: 9, startTime: at(96).toISOString() },
    ]);
  });
});
