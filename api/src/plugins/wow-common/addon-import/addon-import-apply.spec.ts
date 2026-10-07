import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddonGuildExport, AddonRaidExport } from '@raid-ledger/contract';
import type { DecodedAddonCharExport } from './addon-import.decoder';
import type { AddonBindingResult } from './addon-import.binding';
import { AddonImportError } from './addon-import.errors';
import { bindingUpdates } from './addon-import-binding.apply';
import {
  applyChar,
  buildCharSummary,
  decideCharWrite,
  decideLostRace,
} from './addon-import-char.apply';
import {
  assertExporterInGuild,
  buildGuildSummary,
  dedupeMembers,
  guildSet,
  isStaleGuildSnapshot,
  memberValues,
} from './addon-import-guild.apply';
import {
  buildRaidSummary,
  countNewPulls,
  pullKey,
  pullRow,
  rosterEntries,
} from './addon-import-raid.apply';
import {
  guildNameKey,
  type AddonApplyContext,
} from './addon-import-apply.types';

/** ROK-1724 §4.3 Apply — the pure decisions. DB behaviour: integration spec. */

const FIXTURES = join(
  __dirname,
  '../../../../../packages/contract/ledgerlink/v1/fixtures',
);
function fixture<T>(name: string): T {
  const raw = readFileSync(join(FIXTURES, `${name}.json`), 'utf8');
  return (JSON.parse(raw) as { payload: T }).payload;
}

const CTX = {
  tx: undefined as never,
  userId: 7,
  characterId: '00000000-0000-0000-0000-000000000001',
  gameId: 3,
  region: 'us',
  sha256: 'a'.repeat(64),
} satisfies AddonApplyContext;

const EXPORTED_AT = 1_790_000_000;
const at = (s: number) => new Date(s * 1000);
/** Index a fixture array; throws (instead of `!`) when the fixture is short. */
function at0<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`fixture has no index ${i}`);
  return x;
}

describe('char', () => {
  it('summarises char-normal', () => {
    const p = fixture<DecodedAddonCharExport>('char-normal');
    expect(buildCharSummary(p.data)).toEqual({
      gearCount: 2,
      avgIlvl: 78,
      talentNodes: 1,
      lockouts: 1,
    });
  });

  it('avgIlvl is null when no gear row has an ilvl', () => {
    const data = {
      gear: [{ slot: 1, bonusIds: [] }],
      talents: { nodes: [] },
      lockouts: [],
    };
    expect(buildCharSummary(data).avgIlvl).toBeNull();
  });

  it.each([
    ['no stored snapshot → write', undefined, 'write'],
    [
      'same sha256 → noop',
      { payloadSha256: CTX.sha256, capturedAt: at(EXPORTED_AT - 1) },
      'noop',
    ],
    [
      'older exportedAt → stale',
      { payloadSha256: 'b'.repeat(64), capturedAt: at(EXPORTED_AT + 1) },
      'stale',
    ],
    [
      'same capture time, new sha → write',
      { payloadSha256: 'b'.repeat(64), capturedAt: at(EXPORTED_AT) },
      'write',
    ],
    [
      'newer exportedAt → write',
      { payloadSha256: 'b'.repeat(64), capturedAt: at(EXPORTED_AT - 60) },
      'write',
    ],
  ] as const)('%s', (_label, stored, expected) => {
    expect(decideCharWrite(stored, CTX.sha256, EXPORTED_AT)).toBe(expected);
  });
});

/**
 * A tx whose pre-read returns `reads` in order and whose guarded upsert
 * returns `upserted` rows (none = the `setWhere` refused the update).
 */
function charTx(reads: unknown[][], upserted: unknown[]) {
  const where = jest.fn();
  for (const r of reads) where.mockResolvedValueOnce(r);
  const conflict = jest.fn().mockReturnValue({
    returning: jest.fn().mockResolvedValue(upserted),
  });
  const tx = {
    select: () => ({ from: () => ({ where }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: conflict }) }),
  };
  return { tx: tx as never, conflict };
}

describe('char apply — overlapping applies (Codex P2)', () => {
  const older = {
    schema: 1,
    exportedAt: EXPORTED_AT,
    data: { gear: [], talents: { nodes: [] }, lockouts: [] },
  } as unknown as DecodedAddonCharExport;
  const newer = {
    payloadSha256: 'b'.repeat(64),
    capturedAt: at(EXPORTED_AT + 60),
  };

  it.each([
    [
      'same export won the race → noop',
      { ...newer, payloadSha256: CTX.sha256 },
      'noop',
    ],
    ['a newer export won the race → stale', newer, 'stale'],
    ['row vanished → stale (never claims applied)', undefined, 'stale'],
  ] as const)('%s', (_label, stored, expected) => {
    expect(decideLostRace(stored, CTX.sha256)).toBe(expected);
  });

  it('an older export that passed the stale pre-read cannot overwrite the newer snapshot', async () => {
    // Pre-read saw nothing (the newer apply had not committed); by the time
    // our upsert ran, the newer row was there and `setWhere` refused it.
    const { tx, conflict } = charTx([[], [newer]], []);
    const res = await applyChar({ ...CTX, tx }, older);
    expect(res.status).toBe('stale');
    const [arg] = conflict.mock.calls[0] as [{ setWhere?: unknown }];
    expect(arg.setWhere).toBeDefined();
  });

  it('the guarded upsert returning its row → applied', async () => {
    const { tx } = charTx([[]], [{ characterId: CTX.characterId }]);
    expect((await applyChar({ ...CTX, tx }, older)).status).toBe('applied');
  });
});

describe('character-row binding updates', () => {
  const base: AddonBindingResult = {
    errors: [],
    warnings: [],
    diff: {},
    pinGuid: null,
  };

  it('nothing to change → empty set', () => {
    expect(bindingUpdates(base)).toEqual({});
  });

  it('maps pin, confirmed ruleset, class + level', () => {
    expect(
      bindingUpdates({
        ...base,
        pinGuid: 'Player-4395-0ABCDEF0',
        setRuleset: 'pvp',
        diff: { class: { from: null, to: 'Mage' }, level: { from: 1, to: 60 } },
      }),
    ).toEqual({
      addonGuid: 'Player-4395-0ABCDEF0',
      ruleset: 'pvp',
      class: 'Mage',
      level: 60,
    });
  });
});

/** The golden guild fixture — its roster includes the exporter (member #1). */
function guildWithExporter(): AddonGuildExport {
  const p = fixture<AddonGuildExport>('guild-1-page');
  if (!p.data.members.some((m) => m.guid === p.who.guid)) {
    throw new Error('guild-1-page fixture lost the exporter');
  }
  return p;
}

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AddonImportError ? e.code : String(e);
  }
}

describe('guild', () => {
  it('NOT_IN_GUILD when the exporter is missing from the roster', () => {
    const p = guildWithExporter();
    const without = {
      ...p,
      data: {
        ...p.data,
        members: p.data.members.filter((m) => m.guid !== p.who.guid),
      },
    };
    expect(codeOf(() => assertExporterInGuild(without))).toBe('NOT_IN_GUILD');
    expect(codeOf(() => assertExporterInGuild(p))).toBeNull();
  });

  it.each([
    ['no stored snapshot', null, false],
    ['older snapshot', at(EXPORTED_AT + 1), true],
    ['equal snapshot', at(EXPORTED_AT), false],
    ['newer snapshot', at(EXPORTED_AT - 1), false],
  ] as const)('stale? %s', (_label, last, expected) => {
    expect(isStaleGuildSnapshot(last, EXPORTED_AT)).toBe(expected);
  });
});

describe('guild rows', () => {
  it('summary splits new vs updated members', () => {
    expect(buildGuildSummary(guildWithExporter(), 1, 5)).toEqual({
      guildName: 'Night Shift',
      members: 40,
      newMembers: 5,
      updatedMembers: 35,
      pages: 1,
    });
  });

  it('member row: public note only when present, no officer-note key', () => {
    const members = fixture<AddonGuildExport>('guild-1-page').data.members;
    // [0] is the exporter; [1] is Member1 (noted), [2] Member2 (no note).
    const withNote = at0(members, 1);
    const without = at0(members, 2);
    const row = memberValues(withNote, 9, CTX, at(EXPORTED_AT));
    expect(row).toMatchObject({
      guildId: 9,
      guid: withNote.guid,
      publicNote: 'Main tank',
      source: 'addon_import',
      lastSeenAt: at(EXPORTED_AT),
      capturedByUserId: 7,
    });
    expect(Object.keys(row).join(',')).not.toMatch(/officer/i);
    expect(
      memberValues(without, 9, CTX, at(EXPORTED_AT)).publicNote,
    ).toBeNull();
  });

  it('dedupeMembers keeps one row per GUID (last wins)', () => {
    const members = fixture<AddonGuildExport>('guild-1-page').data.members;
    const a = at0(members, 0);
    const b = at0(members, 1);
    const out = dedupeMembers([a, b, { ...a, rank: 'Officer' }]);
    expect(out.map((m) => [m.guid, m.rank])).toEqual([
      [a.guid, 'Officer'],
      [b.guid, b.rank],
    ]);
  });

  it('guild columns come from the snapshot', () => {
    expect(guildSet(guildWithExporter())).toMatchObject({
      name: 'Night Shift',
      memberCount: 40,
      lastSnapshotAt: at(EXPORTED_AT),
    });
  });
});

describe('raid', () => {
  const raid = () => fixture<AddonRaidExport>('raid');

  it('summary counts kills, wipes, new vs duplicate', () => {
    const pulls = raid().data.pulls;
    const first = at0(pulls, 0);
    const wipe = { ...first, success: false, startAt: first.startAt + 600 };
    expect(buildRaidSummary([...pulls, wipe], 1)).toEqual({
      pulls: 2,
      newPulls: 1,
      duplicatePulls: 1,
      kills: 1,
      wipes: 1,
    });
  });

  it('countNewPulls: stored keys and in-payload repeats are not new', () => {
    const p = at0(raid().data.pulls, 0);
    const later = { ...p, startAt: p.startAt + 600 };
    const stored = new Set([pullKey(p.encounterId, p.startAt * 1000)]);
    expect(countNewPulls([p, later, later], stored)).toBe(1);
    expect(countNewPulls([p, later], new Set())).toBe(2);
  });

  it('pull row: dedupe key fields, lowercased guild key, zipped roster', () => {
    const p = raid();
    const row = pullRow(at0(p.data.pulls, 0), p, CTX);
    expect(row).toMatchObject({
      gameId: 3,
      region: 'us',
      encounterId: 663,
      guildKey: 'night shift',
      startAt: at(at0(p.data.pulls, 0).startAt),
      reportedByUserId: 7,
      reportedByCharacterId: CTX.characterId,
      payloadSha256: CTX.sha256,
    });
    expect(row.roster).toEqual([{ guid: p.who.guid, name: 'Ana Forever' }]);
  });

  it('roster name falls back to empty when rosterNames is short', () => {
    const p = at0(raid().data.pulls, 0);
    expect(rosterEntries({ ...p, rosterNames: [] })).toEqual([
      { guid: p.roster[0], name: '' },
    ]);
  });

  it('guild key is empty for an unguilded reporter', () => {
    expect(guildNameKey(undefined)).toBe('');
    expect(guildNameKey('  Night Shift ')).toBe('night shift');
  });
});
