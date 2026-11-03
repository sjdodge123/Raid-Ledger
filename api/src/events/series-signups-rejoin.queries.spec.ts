/**
 * ROK-1728 Q6 — `series_left` metadata parsing. Absent or malformed
 * `cancelledEventIds` yields `[]` (every night `stays_inactive`), never a throw.
 */
import { cancelledEventIdsOf } from './series-signups-rejoin.queries';

describe('cancelledEventIdsOf', () => {
  it('returns the integer ids of a well-formed metadata object', () => {
    expect(cancelledEventIdsOf({ cancelledEventIds: [3, 5] })).toEqual([3, 5]);
  });

  it.each([
    ['null metadata', null],
    ['undefined metadata', undefined],
    ['a string', 'cancelledEventIds'],
    ['an array', [1, 2]],
    ['no cancelledEventIds key', { seriesSignupId: 1, cancelled: 2 }],
    ['cancelledEventIds not an array', { cancelledEventIds: '1,2' }],
    ['cancelledEventIds null', { cancelledEventIds: null }],
  ])('returns [] for %s', (_label: string, metadata: unknown) => {
    expect(cancelledEventIdsOf(metadata)).toEqual([]);
  });

  it('drops non-integer entries', () => {
    expect(
      cancelledEventIdsOf({ cancelledEventIds: [1, '2', 2.5, null, 4] }),
    ).toEqual([1, 4]);
  });
});
