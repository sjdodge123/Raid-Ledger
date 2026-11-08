/**
 * ROK-2137 — which `game_*` columns one LedgerLink guild report writes.
 * Absent = no opinion (no column), '' = a reported empty box (NULL text).
 */
import { gameTextReport } from './addon-import-guild.game-text';

const AT = new Date('2026-11-08T12:00:00.000Z');

describe('gameTextReport', () => {
  it('reports nothing when the export carries neither key', () => {
    expect(gameTextReport({}, AT)).toEqual({});
  });

  it('writes only the field the export carries', () => {
    expect(gameTextReport({ infoText: 'About us' }, AT)).toEqual({
      gameInfo: 'About us',
      gameInfoReportedAt: AT,
    });
  });

  it('stores an empty in-game box as NULL with a fresh timestamp', () => {
    expect(gameTextReport({ motd: '  ' }, AT)).toEqual({
      gameMotd: null,
      gameMotdReportedAt: AT,
    });
  });

  it('normalises like the hub (CRLF → LF, trailing whitespace) and keeps colour codes', () => {
    expect(
      gameTextReport({ motd: '|cffff0000MC|r Thu  \r\nbring FR\r\n' }, AT)
        .gameMotd,
    ).toBe('|cffff0000MC|r Thu\nbring FR');
  });
});
