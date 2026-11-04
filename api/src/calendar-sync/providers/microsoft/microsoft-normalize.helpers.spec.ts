/**
 * ROK-1597 T7, T8, T9: the `showAs` table, the all-day mailbox-timezone
 * trap (spec §3.3, fixture-tested) and the privacy of a normalised block.
 */
import {
  MICROSOFT_SHOW_AS_BUSY,
  normalizeGraphEvent,
} from './microsoft-normalize.helpers';
import { allDayDateOf, graphUtcInstant } from './microsoft-all-day.helpers';
import { fixture } from './microsoft-graph-api.spec-helpers';
import { RL_COPY_PROP_ID } from './microsoft-graph.constants';

const timed = (over: Record<string, unknown> = {}) => ({
  showAs: 'busy',
  isAllDay: false,
  isCancelled: false,
  responseStatus: { response: 'accepted' },
  start: { dateTime: '2026-11-03T18:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-11-03T20:00:00.0000000', timeZone: 'UTC' },
  ...over,
});
const BLOCK = {
  start: new Date('2026-11-03T18:00:00.000Z'),
  end: new Date('2026-11-03T20:00:00.000Z'),
  allDay: false,
};

describe('showAs → busy (T7, spec §3.2 table)', () => {
  it.each<[string | undefined, boolean]>([
    ['busy', true],
    ['oof', true],
    ['tentative', false],
    ['free', false],
    ['workingElsewhere', false],
    ['unknown', false],
    [undefined, false],
    ['someFutureValue', false],
  ])('showAs %s → busy %s', (showAs, busy) => {
    const out = normalizeGraphEvent(timed({ showAs }));
    expect(out === null ? 'not busy' : 'busy').toBe(busy ? 'busy' : 'not busy');
  });

  it('the busy set is exactly busy + oof', () => {
    expect([...MICROSOFT_SHOW_AS_BUSY].sort()).toEqual(['busy', 'oof']);
  });

  it('a cancelled occurrence is dropped even when busy', () => {
    expect(normalizeGraphEvent(timed({ isCancelled: true }))).toBeNull();
  });

  it('an invitation the user declined is dropped even when busy (Q2)', () => {
    const declined = timed({ responseStatus: { response: 'declined' } });
    expect(normalizeGraphEvent(declined)).toBeNull();
  });

  it('a busy timed event becomes a [start, end) block', () => {
    expect(normalizeGraphEvent(timed())).toEqual(BLOCK);
  });

  it('a non-UTC dateTime is dropped, never shifted', () => {
    const local = timed({
      start: {
        dateTime: '2026-11-03T18:00:00',
        timeZone: 'Pacific Standard Time',
      },
    });
    expect(normalizeGraphEvent(local)).toBeNull();
  });

  it('an inverted or zero-length timed event is dropped', () => {
    expect(normalizeGraphEvent(timed({ end: timed().start }))).toBeNull();
  });
});

describe('all-day events in a non-UTC mailbox (T8, spec §3.3)', () => {
  it.each<[string, string, string]>([
    ['all-day-berlin-utc-shifted', '2026-11-05', '2026-11-05'],
    ['all-day-midnight', '2026-11-05', '2026-11-05'],
    ['all-day-new-york', '2026-11-05', '2026-11-05'],
    ['all-day-multi-day', '2026-11-05', '2026-11-07'],
    ['all-day-tonga', '2026-11-05', '2026-11-05'],
  ])('%s → %s..%s', (name, first, lastInclusive) => {
    const block = normalizeGraphEvent(fixture(name));
    expect(block?.allDayDates).toEqual({ first, lastInclusive });
    expect(block?.allDay).toBe(true);
    expect(block?.start).toEqual(new Date(`${first}T00:00:00.000Z`));
  });

  it('Berlin 23:00Z is never truncated to the previous day (the trap)', () => {
    const block = normalizeGraphEvent(fixture('all-day-berlin-utc-shifted'));
    expect(block?.allDayDates?.first).not.toBe('2026-11-04');
  });

  it('rounding alone (Windows zone name) is exact inside (−12h, +12h)', () => {
    const ny = Date.parse('2026-11-05T05:00:00Z');
    expect(allDayDateOf(ny, 'Eastern Standard Time')).toBe('2026-11-05');
    const tokyo = Date.parse('2026-11-04T15:00:00Z');
    expect(allDayDateOf(tokyo, 'Tokyo Standard Time')).toBe('2026-11-05');
  });

  it('known limit: Tonga (+13) with a Windows zone name rounds to the wrong day', () => {
    const tonga = Date.parse('2026-11-04T11:00:00Z');
    expect(allDayDateOf(tonga, 'Tonga Standard Time')).toBe('2026-11-04');
  });

  it('an exact UTC midnight is taken as the date even with a negative IANA zone', () => {
    const midnight = Date.parse('2026-11-05T00:00:00Z');
    expect(allDayDateOf(midnight, 'America/New_York')).toBe('2026-11-05');
  });

  it('a degenerate all-day span is dropped', () => {
    const same = { ...timed(), isAllDay: true, end: timed().start };
    expect(normalizeGraphEvent(same)).toBeNull();
  });

  it('parses Graph 7-digit fractions as UTC', () => {
    const v = { dateTime: '2026-11-04T23:00:00.1234567', timeZone: 'UTC' };
    expect(graphUtcInstant(v)).toBe(Date.parse('2026-11-04T23:00:00.123Z'));
  });
});

describe('privacy + copy id (T9)', () => {
  const mixed = fixture('calendarview-mixed');
  const items =
    mixed !== null &&
    typeof mixed === 'object' &&
    'value' in mixed &&
    Array.isArray(mixed.value)
      ? mixed.value
      : [];

  it('a private event yields only start/end/allDay — no subject, location or attendees', () => {
    const block = normalizeGraphEvent(items[0]);
    expect(block).toEqual({
      start: new Date('2026-11-03T18:00:00.000Z'),
      end: new Date('2026-11-03T19:30:00.000Z'),
      allDay: false,
    });
  });

  it('our copy carries ourId from the expanded extended property', () => {
    expect(normalizeGraphEvent(items[1])?.ourId).toBe('rl:0123456789ab:42:7');
  });

  it('the property id is matched case-insensitively; a foreign property is ignored', () => {
    const prop = (id: string) =>
      timed({
        singleValueExtendedProperties: [{ id, value: 'rl:0123456789ab:42:7' }],
      });
    expect(
      normalizeGraphEvent(prop(RL_COPY_PROP_ID.toUpperCase()))?.ourId,
    ).toBe('rl:0123456789ab:42:7');
    expect(
      normalizeGraphEvent(
        prop('String {00000000-0000-0000-0000-000000000000} Name other'),
      ),
    ).toEqual(BLOCK);
  });
});
