/**
 * ROK-2137 — which `game_*` columns one LedgerLink guild report writes.
 * Absent = no opinion (no column), '' = a reported empty box (NULL text).
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  changedNotOlder,
  conflictSet,
  gameTextReport,
} from './addon-import-guild.game-text';

const AT = new Date('2026-11-08T12:00:00.000Z');

describe('gameTextReport', () => {
  it('reports nothing when the export carries neither key', () => {
    expect(gameTextReport({}, AT)).toEqual({});
  });

  it('writes only the field the export carries', () => {
    expect(gameTextReport({ infoText: 'About us' }, AT)).toEqual({
      gameInfo: 'About us',
      gameInfoReportedAt: AT,
      gameInfoReportedBy: null,
    });
  });

  it('stores an empty in-game box as NULL with a fresh timestamp', () => {
    expect(gameTextReport({ motd: '  ' }, AT)).toEqual({
      gameMotd: null,
      gameMotdReportedAt: AT,
      gameMotdReportedBy: null,
    });
  });

  it('normalises like the hub (CRLF → LF, trailing whitespace) and keeps colour codes', () => {
    expect(
      gameTextReport({ motd: '|cffff0000MC|r Thu  \r\nbring FR\r\n' }, AT)
        .gameMotd,
    ).toBe('|cffff0000MC|r Thu\nbring FR');
  });
});

describe('gameTextReport — review r1', () => {
  it('strips the control characters the hub save rejects (tab, BEL, C1), keeping newlines', () => {
    expect(
      gameTextReport({ motd: 'Raid\tThu\u0007\r\nbring\u009b FR' }, AT)
        .gameMotd,
    ).toBe('RaidThu\nbring FR');
  });

  it('records the exporting character on each reported field', () => {
    expect(gameTextReport({ motd: 'Hi', infoText: '' }, AT, 'Thrall')).toEqual({
      gameMotd: 'Hi',
      gameMotdReportedAt: AT,
      gameMotdReportedBy: 'Thrall',
      gameInfo: null,
      gameInfoReportedAt: AT,
      gameInfoReportedBy: 'Thrall',
    });
  });
});

describe('changedNotOlder (per-field conflict CASE)', () => {
  const render = (column: Parameters<typeof changedNotOlder>[0]) =>
    new PgDialect().sqlToQuery(changedNotOlder(column, 'Motd')).sql;

  it('moves a field only when the report is not older AND its text changed', () => {
    const q = render('gameMotdReportedAt');
    expect(q).toContain('"game_motd_reported_at" IS NULL OR (');
    expect(q).toContain('<= excluded."game_motd_reported_at"');
    expect(q).toContain('"game_motd" IS DISTINCT FROM excluded."game_motd")');
    expect(q).toContain('THEN excluded."game_motd_reported_at"');
    expect(q).toMatch(/ELSE "(guild_profiles"\.")?game_motd_reported_at" END$/);
  });

  it('guards text, stamp and reporter of only the fields the report carries', () => {
    const set = conflictSet(gameTextReport({ motd: 'Hi' }, AT, 'Thrall'));
    expect(Object.keys(set).sort()).toEqual([
      'gameMotd',
      'gameMotdReportedAt',
      'gameMotdReportedBy',
    ]);
    expect(render('gameMotdReportedBy')).toContain(
      'THEN excluded."game_motd_reported_by"',
    );
  });
});
