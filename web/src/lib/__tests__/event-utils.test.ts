import { describe, it, expect } from 'vitest';
import { getRelativeTime } from '../event-utils';

/**
 * Regression: getEndedRelativeTime used Math.round, so the day/hour unit rolled
 * over ~11h early — an event ended 13h ago read "ended 1 day ago". Now floors,
 * matching the sibling relative-time formatters.
 */
describe('getRelativeTime — ended events floor the unit', () => {
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  it('an event ended 13h ago reads hours, not "1 day ago"', () => {
    const label = getRelativeTime(iso(14 * 3600_000), iso(13 * 3600_000));
    expect(label).toContain('hours ago');
    expect(label).not.toContain('day ago');
  });

  it('an event ended 25h ago reads "1 day ago"', () => {
    const label = getRelativeTime(iso(26 * 3600_000), iso(25 * 3600_000));
    expect(label).toContain('1 day ago');
  });
});
