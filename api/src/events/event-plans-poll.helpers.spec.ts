/**
 * Unit tests for mapToConcreteDates (tech-debt 3110): malformed `dow:hour`
 * availability keys are skipped instead of looping forever.
 */
import { mapToConcreteDates } from './event-plans-poll.helpers';

/** Monday 2026-01-05 12:00 local time. */
const AFTER = new Date(2026, 0, 5, 12, 0, 0, 0);

describe('mapToConcreteDates', () => {
  it('maps a valid key to its next local day/hour (dow 0 = Monday)', () => {
    const result = mapToConcreteDates([['1:20', 3]], 0, AFTER, 7);

    expect(result).toHaveLength(1);
    const date = new Date(result[0]?.date ?? '');
    expect(date.getDay()).toBe(2); // Tuesday
    expect(date.getHours()).toBe(20);
    expect(result[0]?.availableCount).toBe(3);
  });

  it('skips keys whose dow or hour is out of range', () => {
    const result = mapToConcreteDates(
      [
        ['7:20', 5],
        ['1:24', 5],
        ['1:20', 3],
      ],
      0,
      AFTER,
      7,
    );

    expect(result.map((s) => s.availableCount)).toEqual([3]);
  });

  it('returns without the key for a negative or fractional dow', () => {
    const result = mapToConcreteDates(
      [
        ['-2:20', 5],
        ['1.5:20', 5],
        ['1:20', 3],
      ],
      0,
      AFTER,
      7,
    );

    expect(result.map((s) => s.availableCount)).toEqual([3]);
  });

  it('returns without the key for a NaN or missing hour', () => {
    const result = mapToConcreteDates(
      [
        ['1:abc', 5],
        ['1', 5],
        ['1:20', 3],
      ],
      0,
      AFTER,
      7,
    );

    expect(result.map((s) => s.availableCount)).toEqual([3]);
  });
});
