/**
 * ROK-1760 review — the error-row view floor only applies while the backoff
 * is still short; after 3 failed runs the hour-scale backoff is honoured.
 */
import { ERROR_VIEW_RETRY_FLOOR_MS, isMetaDue } from './wow-item-meta.due';
import { WOWHEAD_TOOLTIP_PARSE_VERSION } from './wowhead-item.types';

const NOW = Date.UTC(2026, 9, 10, 12);
const HOUR = 3_600_000;

function errorRow(attempts: number) {
  return {
    status: 'error' as const,
    attempts,
    fetchedAt: new Date(NOW - ERROR_VIEW_RETRY_FLOOR_MS),
    nextRetryAt: new Date(NOW + 8 * HOUR),
    tooltipVersion: null,
  };
}

describe('isMetaDue — error view floor (ROK-1760)', () => {
  it.each([0, 1, 2])(
    'an error row with %i attempts is due once the floor has passed',
    (attempts) => {
      expect(isMetaDue(errorRow(attempts), NOW)).toBe(true);
    },
  );

  it.each([3, 4, 10])(
    'an error row with %i attempts waits for its backoff next_retry_at',
    (attempts) => {
      expect(isMetaDue(errorRow(attempts), NOW)).toBe(false);
    },
  );

  it('the floor still has not passed 1 ms early', () => {
    const row = {
      ...errorRow(1),
      fetchedAt: new Date(NOW - ERROR_VIEW_RETRY_FLOOR_MS + 1),
    };
    expect(isMetaDue(row, NOW)).toBe(false);
  });

  it('a past next_retry_at is due whatever the attempt count', () => {
    const row = { ...errorRow(5), nextRetryAt: new Date(NOW - 1) };
    expect(isMetaDue(row, NOW)).toBe(true);
  });
});

describe('isMetaDue — stale tooltip parse (ROK-2176)', () => {
  const found = (
    status: 'resolved' | 'classic_fallback' | 'not_found',
    tooltipVersion: number | null,
  ) => ({
    status,
    attempts: 0,
    fetchedAt: new Date(NOW - HOUR),
    nextRetryAt: new Date(NOW + 20 * 24 * HOUR),
    tooltipVersion,
  });

  it.each([
    ['resolved', null],
    ['resolved', WOWHEAD_TOOLTIP_PARSE_VERSION - 1],
    ['classic_fallback', null],
  ] as const)(
    'a %s row parsed by version %s is due before its next_retry_at',
    (status, version) => {
      expect(isMetaDue(found(status, version), NOW)).toBe(true);
    },
  );

  it.each(['resolved', 'classic_fallback'] as const)(
    'a %s row at the current parser version waits for next_retry_at',
    (status) => {
      expect(isMetaDue(found(status, WOWHEAD_TOOLTIP_PARSE_VERSION), NOW)).toBe(
        false,
      );
    },
  );

  it('a not_found row with no tooltip waits for its backoff', () => {
    expect(isMetaDue(found('not_found', null), NOW)).toBe(false);
  });
});
