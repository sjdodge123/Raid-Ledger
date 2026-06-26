import { PgDialect } from 'drizzle-orm/pg-core';
import {
  stripSearchPunctuation,
  escapeLikePattern,
  buildWordMatchFilters,
} from './search.util';
import * as schema from '../drizzle/schema';

describe('stripSearchPunctuation', () => {
  it('removes colons, dashes, em-dashes, apostrophes, periods, and commas', () => {
    expect(stripSearchPunctuation('Halo: Combat Evolved')).toBe(
      'Halo Combat Evolved',
    );
    expect(stripSearchPunctuation("Tom Clancy's")).toBe('Tom Clancys');
    expect(stripSearchPunctuation('Counter-Strike')).toBe('CounterStrike');
    expect(stripSearchPunctuation('Hello — World')).toBe('Hello World');
    expect(stripSearchPunctuation('v1.0.2, final')).toBe('v102 final');
  });

  it('collapses multiple spaces into one', () => {
    expect(stripSearchPunctuation('hello    world')).toBe('hello world');
    expect(stripSearchPunctuation('  spaced  out  ')).toBe('spaced out');
  });

  it('trims leading and trailing whitespace', () => {
    expect(stripSearchPunctuation('  hello  ')).toBe('hello');
  });

  it('returns empty string for punctuation-only input', () => {
    expect(stripSearchPunctuation('...:---')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(stripSearchPunctuation('')).toBe('');
  });

  it('preserves digits and letters', () => {
    expect(stripSearchPunctuation('Halo 3')).toBe('Halo 3');
  });
});

describe('escapeLikePattern', () => {
  it('escapes percent sign', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
  });

  it('escapes underscore', () => {
    expect(escapeLikePattern('some_thing')).toBe('some\\_thing');
  });

  it('escapes backslash', () => {
    expect(escapeLikePattern('path\\to')).toBe('path\\\\to');
  });

  it('escapes all special characters together', () => {
    expect(escapeLikePattern('%_\\')).toBe('\\%\\_\\\\');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeLikePattern('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(escapeLikePattern('')).toBe('');
  });
});

function describeBuildWordMatchFilters() {
  // We cannot test the actual SQL output easily without a full Drizzle
  // column instance, but we can verify the function's observable behavior:
  // - returns empty array for empty/blank/punctuation-only queries
  // - returns one filter per word
  // We use a mock column to satisfy the type signature.

  const mockColumn = { name: 'name' } as never;

  it('returns empty array for empty string', () => {
    expect(buildWordMatchFilters(mockColumn, '')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(buildWordMatchFilters(mockColumn, '   ')).toEqual([]);
  });

  it('returns empty array for punctuation-only input', () => {
    expect(buildWordMatchFilters(mockColumn, '...:---')).toEqual([]);
  });

  it('returns one filter for a single word', () => {
    const filters = buildWordMatchFilters(mockColumn, 'halo');
    expect(filters).toHaveLength(1);
  });

  it('returns multiple filters for multi-word queries', () => {
    const filters = buildWordMatchFilters(mockColumn, 'halo combat evolved');
    expect(filters).toHaveLength(3);
  });

  it('strips punctuation before splitting', () => {
    const filters = buildWordMatchFilters(mockColumn, 'halo: combat');
    expect(filters).toHaveLength(2);
  });

  it('handles mixed punctuation and multiple spaces', () => {
    const filters = buildWordMatchFilters(
      mockColumn,
      "  Tom Clancy's:  Rainbow — Six  ",
    );
    expect(filters).toHaveLength(4); // Tom Clancys Rainbow Six
  });

  it('normalizes the COLUMN too so apostrophe titles match (ROK-1369)', () => {
    // The bug normalized only the QUERY side: `%baldurs%` ILIKE against the raw
    // `Baldur's Gate 3` column never matched. The rendered SQL must strip
    // punctuation from the column with the same regexp_replace.
    const dialect = new PgDialect();
    const [filter] = buildWordMatchFilters(schema.games.name, "Baldur's");
    const { sql } = dialect.sqlToQuery(filter);
    expect(sql).toContain('regexp_replace');
    expect(sql.toLowerCase()).toContain('ilike');
  });
}
describe('buildWordMatchFilters', () => describeBuildWordMatchFilters());
