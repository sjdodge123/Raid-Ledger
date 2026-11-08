/**
 * ROK-2137 — which `game_*` columns one LedgerLink guild report writes.
 * Absent = no opinion (no column), '' = a reported empty box (NULL text).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AddonGuildExport } from '@raid-ledger/contract';
import { guildProfiles, guilds } from '../../../drizzle/schema';
import { createDrizzleMock } from '../../../common/testing/drizzle-mock';
import type { AddonImportTx, RosterFlag } from './addon-import-apply.types';
import { applyGuild } from './addon-import-guild.apply';
import { checkRosterReplace } from './addon-import-guild.guard';
import {
  changedNotOlder,
  conflictSet,
  gameTextReport,
} from './addon-import-guild.game-text';

jest.mock('./addon-import-guild.guard', () => ({
  ...jest.requireActual<object>('./addon-import-guild.guard'),
  lockGuildImport: jest.fn().mockResolvedValue(undefined),
  checkRosterReplace: jest.fn(),
  auditRosterReplaced: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./addon-import-guild.members', () => ({
  ...jest.requireActual<object>('./addon-import-guild.members'),
  upsertMembersLoggingDings: jest.fn().mockResolvedValue(0),
}));

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
    expect(q).toContain('THEN GREATEST(excluded."game_motd_reported_at", ');
    expect(q).toMatch(/ELSE "(guild_profiles"\.")?game_motd_reported_at" END$/);
  });

  it('review r2 — a move strictly advances the stamp and clears the acknowledgement', () => {
    expect(render('gameMotdReportedAt')).toMatch(
      /GREATEST\(excluded\."game_motd_reported_at", "(guild_profiles"\.")?game_motd_reported_at" \+ interval '1 millisecond'\)/,
    );
    const ack = render('gameMotdAcknowledgedAt');
    expect(ack).toContain(' THEN NULL ELSE ');
    expect(ack).toMatch(
      /ELSE "(guild_profiles"\.")?game_motd_acknowledged_at" END$/,
    );
  });

  it('guards text, stamp and reporter of only the fields the report carries', () => {
    const set = conflictSet(gameTextReport({ motd: 'Hi' }, AT, 'Thrall'));
    expect(Object.keys(set).sort()).toEqual([
      'gameMotd',
      'gameMotdAcknowledgedAt',
      'gameMotdReportedAt',
      'gameMotdReportedBy',
    ]);
    expect(render('gameMotdReportedBy')).toContain(
      'THEN excluded."game_motd_reported_by"',
    );
  });
});

describe('applyGuild — flagged roster replacement (review r1)', () => {
  const FIXTURES = join(
    __dirname,
    '../../../../../packages/contract/ledgerlink/v1/fixtures',
  );
  const payload = (): AddonGuildExport => {
    const raw = readFileSync(join(FIXTURES, 'guild-1-page.json'), 'utf8');
    const p = (JSON.parse(raw) as { payload: AddonGuildExport }).payload;
    return { ...p, data: { ...p.data, motd: 'Hijacked', infoText: 'Spam' } };
  };
  const FLAG: RosterFlag = {
    guildId: 7,
    removed: 40,
    added: 0,
    live: 50,
    dropsEditor: false,
  };

  async function run(flag: RosterFlag | null) {
    jest.mocked(checkRosterReplace).mockResolvedValue({
      delta: { removed: flag?.removed ?? 0, added: 0 },
      flag,
    });
    const db = createDrizzleMock();
    db.where.mockResolvedValueOnce([{ id: 7, lastSnapshotAt: null }]);
    db.returning.mockResolvedValueOnce([{ id: 7 }]);
    const ctx = {
      tx: db as unknown as AddonImportTx,
      userId: 7,
      characterId: '00000000-0000-0000-0000-000000000001',
      gameId: 3,
      region: 'us' as const,
      sha256: 'a'.repeat(64),
    };
    const outcome = await applyGuild(ctx, payload(), 1);
    const tables: unknown[] = db.insert.mock.calls.map((c: unknown[]) => c[0]);
    return { outcome, tables };
  }

  it('writes no game_* text when the replacement is flagged', async () => {
    const { outcome, tables } = await run(FLAG);
    expect(outcome.rosterFlag).toEqual(FLAG);
    expect(tables).toContain(guilds);
    expect(tables).not.toContain(guildProfiles);
  });

  it('control: an unflagged import does write the reported text', async () => {
    const { tables } = await run(null);
    expect(tables).toContain(guildProfiles);
  });
});
