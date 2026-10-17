/**
 * Unit test for the mock-Redis teardown prefixes in `truncateAllTables`.
 *
 * The integration TestApp's Redis mock outlives every truncate, so a dedup
 * key whose prefix is missing from the list survives into the next test while
 * its `notification_dedup` row does not. ROK-1435: the weekly digest's
 * ISO-week claim leaked that way and turned the next test's first post into
 * a `duplicate`.
 */
import { digestDedupKey } from '../../notifications/weekly-digest-schedule.helpers';
import { MOCK_REDIS_TEARDOWN_PREFIXES } from './integration-helpers';

// Keep the real TestApp (and its Testcontainers imports) out of a unit run.
jest.mock('./test-app', () => ({ INSTANCE_KEY: '__raid_ledger_test_app' }));

/** Every teardown prefix that would purge `key` from the Redis mock. */
function prefixesPurging(key: string): string[] {
  return MOCK_REDIS_TEARDOWN_PREFIXES.filter((p) => key.startsWith(p));
}

describe('truncateAllTables mock-Redis teardown prefixes', () => {
  it("purges the weekly digest's ISO-week dedup claim (ROK-1435)", () => {
    const key = digestDedupKey(new Date('2026-09-21T09:05:00Z'), 'UTC');
    expect(key).toBe('weekly-digest:2026-W39');
    expect(prefixesPurging(key)).toEqual(['weekly-digest:']);
  });
});
