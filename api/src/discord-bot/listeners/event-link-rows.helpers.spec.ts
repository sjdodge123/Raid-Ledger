import {
  capActionRows,
  MAX_ACTION_ROWS,
  unfurlRowEntries,
} from './event-link-rows.helpers';

const entry = (
  row: string,
  series: boolean,
): { row: string; series: boolean } => ({ row, series });

describe('capActionRows', () => {
  it('keeps every row, in order, when the total fits Discord’s 5-row limit', () => {
    expect(
      capActionRows([
        entry('a', false),
        entry('a-series', true),
        entry('b', false),
      ]),
    ).toEqual(['a', 'a-series', 'b']);
  });

  it('drops Join Series rows (last first) before any primary signup row', () => {
    const rows = capActionRows([
      entry('a', false),
      entry('a-s', true),
      entry('b', false),
      entry('b-s', true),
      entry('c', false),
      entry('c-s', true),
    ]);
    expect(rows).toEqual(['a', 'a-s', 'b', 'b-s', 'c']);
    expect(rows).toHaveLength(MAX_ACTION_ROWS);
  });

  it('never returns more than 5 rows even when primary rows alone exceed it', () => {
    const rows = capActionRows(
      ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((r) => [
        entry(r, false),
        entry(`${r}-s`, true),
      ]),
    );
    expect(rows).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('unfurlRowEntries', () => {
  it('tags the signup row as primary and the series row as series', () => {
    expect(unfurlRowEntries({ row: 'r', seriesRow: 's' })).toEqual([
      { row: 'r', series: false },
      { row: 's', series: true },
    ]);
    expect(unfurlRowEntries({})).toEqual([]);
  });
});
