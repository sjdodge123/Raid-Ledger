/**
 * Unit tests for slow-queries helpers (ROK-1156).
 *
 * `diffEntries` is the load-bearing pure function the digest cron and
 * the on-demand snapshot endpoint share. It is responsible for turning
 * two cumulative `pg_stat_statements` snapshots into a per-window delta.
 */
import { diffEntries, type SlowQueryEntryRecord } from './slow-queries.helpers';

function entry(
  queryid: string,
  calls: number,
  totalExecTimeMs: number,
  queryText = 'SELECT 1',
): SlowQueryEntryRecord {
  const meanExecTimeMs = calls > 0 ? totalExecTimeMs / calls : 0;
  return { queryid, queryText, calls, totalExecTimeMs, meanExecTimeMs };
}

describe('diffEntries', () => {
  it('passes every current entry through when baseline is empty (first snapshot)', () => {
    const current = [entry('1', 10, 1000), entry('2', 4, 200)];
    const result = diffEntries(current, []);
    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.queryid).sort();
    expect(ids).toEqual(['1', '2']);
    const r1 = result.find((e) => e.queryid === '1')!;
    expect(r1.calls).toBe(10);
    expect(r1.totalExecTimeMs).toBe(1000);
    expect(r1.meanExecTimeMs).toBeCloseTo(100, 6);
  });

  it('computes deltas when the same queryid appears in both snapshots', () => {
    const baseline = [entry('1', 10, 1000)];
    const current = [entry('1', 14, 1800)];
    const [r1] = diffEntries(current, baseline);
    expect(r1.calls).toBe(4);
    expect(r1.totalExecTimeMs).toBe(800);
    expect(r1.meanExecTimeMs).toBeCloseTo(200, 6);
  });

  it('treats a queryid that exists only in current as fully in-window', () => {
    const baseline = [entry('1', 5, 500)];
    const current = [entry('1', 7, 700), entry('2', 3, 900)];
    const r2 = diffEntries(current, baseline).find((e) => e.queryid === '2')!;
    expect(r2.calls).toBe(3);
    expect(r2.totalExecTimeMs).toBe(900);
    expect(r2.meanExecTimeMs).toBeCloseTo(300, 6);
  });

  it('drops queryids that exist only in baseline', () => {
    const baseline = [entry('stale', 100, 5000)];
    const current = [entry('fresh', 1, 50)];
    const result = diffEntries(current, baseline);
    expect(result).toHaveLength(1);
    expect(result[0].queryid).toBe('fresh');
  });

  it('detects pg_stat_statements_reset (curr.calls < prev.calls) and treats current as fully in-window', () => {
    const baseline = [entry('1', 100, 10000)];
    const current = [entry('1', 5, 750)];
    const [r1] = diffEntries(current, baseline);
    expect(r1.calls).toBe(5);
    expect(r1.totalExecTimeMs).toBe(750);
    expect(r1.meanExecTimeMs).toBeCloseTo(150, 6);
  });

  it('filters out entries with zero calls in the window', () => {
    const baseline = [entry('1', 10, 1000), entry('2', 4, 800)];
    const current = [entry('1', 10, 1000), entry('2', 9, 1800)];
    const result = diffEntries(current, baseline);
    expect(result.map((e) => e.queryid)).toEqual(['2']);
  });

  it('sorts results descending by meanExecTimeMs', () => {
    const baseline: SlowQueryEntryRecord[] = [];
    const current = [
      entry('slow', 2, 800), // mean 400
      entry('fast', 4, 80), // mean 20
      entry('mid', 5, 500), // mean 100
    ];
    const result = diffEntries(current, baseline);
    expect(result.map((e) => e.queryid)).toEqual(['slow', 'mid', 'fast']);
  });
});
