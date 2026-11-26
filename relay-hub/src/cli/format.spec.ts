import { countLines, table } from './format';

describe('table (ROK-1674 CLI formatting)', () => {
  it('pads every column but the last to its widest cell', () => {
    expect(
      table([
        ['kind', 'value', 'source'],
        ['steam_app_id', '570', 'instance'],
      ]),
    ).toEqual(['kind          value  source', 'steam_app_id  570    instance']);
  });

  it('is empty for no rows and tolerates ragged rows', () => {
    expect(table([])).toEqual([]);
    expect(table([['a', 'bb'], ['ccc']])).toEqual(['a    bb', 'ccc']);
  });
});

describe('countLines', () => {
  it('keeps key order and aligns the counts', () => {
    expect(countLines({ steam_app_id: 3, igdb_id: 0 })).toEqual([
      '  steam_app_id  3',
      '  igdb_id       0',
    ]);
  });
});
