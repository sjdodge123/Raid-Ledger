import {
  formatDigestBlock,
  normalizeRawRow,
  type SlowQueryEntryRecord,
  type RawPgStatStatementsRow,
} from './slow-queries.helpers';

const FIXED_AT = new Date('2026-04-28T13:00:00.000Z');

const SAMPLE_ENTRY: SlowQueryEntryRecord = {
  queryid: '12345',
  queryText: 'SELECT * FROM events WHERE id = $1',
  calls: 42,
  meanExecTimeMs: 234.567,
  totalExecTimeMs: 9851.81,
};

describe('formatDigestBlock', () => {
  it('renders header + subtitle + rows + footer when entries exist', () => {
    const block = formatDigestBlock([SAMPLE_ENTRY], FIXED_AT);
    expect(block).toContain(
      '=== Slow Query Digest @ 2026-04-28T13:00:00.000Z ===',
    );
    expect(block).toContain('top 10 by mean_exec_time');
    expect(block).toContain('calls');
    expect(block).toContain('mean_ms');
    expect(block).toContain('total_ms');
    expect(block).toContain('query');
    expect(block).toMatch(/42\s+234\.57\s+9851\.81\s+SELECT \* FROM events/);
    expect(block).toContain('=== End ===');
  });

  it('renders an empty marker when there are no entries', () => {
    const block = formatDigestBlock([], FIXED_AT);
    expect(block).toContain('(no statements crossed the filter)');
    expect(block).not.toContain('mean_ms');
    expect(block).toContain('=== End ===');
  });

  it('collapses multi-line query whitespace to a single line', () => {
    const multiline: SlowQueryEntryRecord = {
      ...SAMPLE_ENTRY,
      queryText:
        'SELECT id\n  FROM users\n  WHERE last_seen > $1\n  ORDER BY id',
    };
    const block = formatDigestBlock([multiline], FIXED_AT);
    expect(block).toContain(
      'SELECT id FROM users WHERE last_seen > $1 ORDER BY id',
    );
    expect(block).not.toContain('\n  FROM');
  });

  it('terminates with a trailing newline so successive appends do not concatenate', () => {
    const block = formatDigestBlock([SAMPLE_ENTRY], FIXED_AT);
    expect(block.endsWith('\n')).toBe(true);
  });

  it('uses the provided capturedAt timestamp', () => {
    const earlier = new Date('2020-01-01T00:00:00.000Z');
    const block = formatDigestBlock([], earlier);
    expect(block).toContain('2020-01-01T00:00:00.000Z');
  });
});

describe('normalizeRawRow', () => {
  it('coerces string-encoded numerics from postgres into JS numbers', () => {
    const raw: RawPgStatStatementsRow = {
      queryid: '999',
      query_text: 'SELECT 1',
      calls: '17',
      mean_exec_time_ms: '12.5',
      total_exec_time_ms: '212.5',
    };
    expect(normalizeRawRow(raw)).toEqual({
      queryid: '999',
      queryText: 'SELECT 1',
      calls: 17,
      meanExecTimeMs: 12.5,
      totalExecTimeMs: 212.5,
    });
  });

  it('passes through already-typed numerics', () => {
    const raw: RawPgStatStatementsRow = {
      queryid: '999',
      query_text: 'SELECT 1',
      calls: 17,
      mean_exec_time_ms: 12.5,
      total_exec_time_ms: 212.5,
    };
    expect(normalizeRawRow(raw).calls).toBe(17);
  });
});
