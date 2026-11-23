import type { AddonErrorExportRowDto } from '@raid-ledger/contract';
import {
  ADDON_ERRORS_CSV_COLUMNS,
  csvCell,
  toAddonErrorsCsv,
} from './wow-addon-errors-admin.csv';
import { toCharacters, toMembers } from './wow-addon-errors-admin.query';

const row = (over: Partial<AddonErrorExportRowDto> = {}) =>
  ({
    id: 7,
    userId: 3,
    username: 'Alpha',
    characterName: '<char>',
    characterRealm: null,
    source: 'buggrabber',
    sourceVersion: '1.0',
    addon: 'Questie',
    message: 'attempt to index nil',
    stack: null,
    count: 4,
    session: 12,
    firstSeenAt: '2026-11-01T00:00:00.000Z',
    lastSeenAt: '2026-11-02T00:00:00.000Z',
    recordHash: 'a'.repeat(64),
    scrubbedCount: 0,
    ...over,
  }) satisfies AddonErrorExportRowDto;

describe('csvCell (ROK-2099 S3)', () => {
  it.each([
    [null, ''],
    [42, '42'],
    ['plain', 'plain'],
    ['a,b', '"a,b"'],
    ['say "hi"', '"say ""hi"""'],
    ['line1\nline2', '"line1\nline2"'],
    ['cr\rhere', '"cr\rhere"'],
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+1', "'+1"],
    ['-x', "'-x"],
    ['@cmd', "'@cmd"],
    ['=a,"b"', `"'=a,""b"""`],
  ])('writes %j as %j', (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
});

describe('toAddonErrorsCsv (ROK-2099 S3)', () => {
  it('writes the header and one CRLF line per row, null as empty', () => {
    const csv = toAddonErrorsCsv([row(), row({ id: 8, stack: 'a\nb' })]);
    const header = ADDON_ERRORS_CSV_COLUMNS.join(',');
    expect(csv).toBe(
      `${header}\r\n` +
        `7,3,Alpha,<char>,,buggrabber,1.0,Questie,attempt to index nil,,4,12,` +
        `2026-11-01T00:00:00.000Z,2026-11-02T00:00:00.000Z,${'a'.repeat(64)},0\r\n` +
        `8,3,Alpha,<char>,,buggrabber,1.0,Questie,attempt to index nil,"a\nb",4,12,` +
        `2026-11-01T00:00:00.000Z,2026-11-02T00:00:00.000Z,${'a'.repeat(64)},0\r\n`,
    );
  });

  it('writes only the header for no rows', () => {
    expect(toAddonErrorsCsv([])).toBe(
      `${ADDON_ERRORS_CSV_COLUMNS.join(',')}\r\n`,
    );
  });
});

describe('group aggregate parsing (ROK-2099 S3)', () => {
  it('sorts members by username and characters by name then realm', () => {
    const members = JSON.stringify([
      { userId: 2, username: 'Zed' },
      { userId: 1, username: 'Amy' },
    ]);
    const chars = JSON.stringify([
      { name: 'Bo', realm: 'Y' },
      { name: 'Bo', realm: 'X' },
      { name: 'Al', realm: null },
    ]);
    expect(toMembers(members)).toEqual([
      { userId: 1, username: 'Amy' },
      { userId: 2, username: 'Zed' },
    ]);
    expect(toCharacters(chars)).toEqual([
      { name: 'Al', realm: null },
      { name: 'Bo', realm: 'X' },
      { name: 'Bo', realm: 'Y' },
    ]);
  });

  it('reads a non-string or non-array cell as empty', () => {
    expect(toMembers(null)).toEqual([]);
    expect(toCharacters('{"a":1}')).toEqual([]);
  });
});
