/**
 * ROK-1745: unit tests for CharacterQuestsService (db, loader and the pure
 * builder are mocked; the real builder is covered by its own spec).
 */
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { CharacterQuestsService } from './character-quests.service';
import { effectiveQuests } from './forever-quest-source.helpers';
import { loadForeverQuestSources } from './forever-quest-source.query';
import { buildCharacterQuests } from './character-quests.helpers';
import { loadCharacterAttunements } from './character-attunements';
import { instanceName } from './dungeon-instance-names';
import type { SettingsService } from '../../settings/settings.service';

jest.mock('./forever-quest-source.query');
jest.mock('./character-quests.helpers');
jest.mock('./character-attunements');

const CHAR_ID = '6f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const CAPTURED = new Date('2026-10-01T12:00:00.000Z');
const sources = jest.mocked(loadForeverQuestSources);
/** Feed the mocked loader a snapshot (or none) through the real D4 helper. */
const loader = {
  mockResolvedValue(snap: { data: unknown; capturedAt: Date } | null): void {
    const eff = effectiveQuests(snap, null);
    sources.mockResolvedValue(new Map(eff ? [[CHAR_ID, eff]] : []));
  },
};
const builder = jest.mocked(buildCharacterQuests);

const KNOWN_ROW = {
  id: 1,
  questId: 5001,
  dungeonInstanceId: 226,
  name: 'Known Quest',
  questLevel: 20,
  requiredLevel: 15,
  expansion: 'classic',
  questGiverNpc: null,
  questGiverZone: null,
  prevQuestId: null,
  nextQuestId: null,
  rewardsJson: null,
  objectives: null,
  classRestriction: null,
  raceRestriction: null,
  startsInsideDungeon: false,
  sharable: true,
  rewardXp: null,
  rewardGold: null,
  rewardType: null,
};

/** A thenable query builder resolving to `rows`; `limit` resolves too. */
function query(rows: unknown[]): Record<string, unknown> {
  const q: Record<string, unknown> = {};
  q.from = jest.fn(() => q);
  q.where = jest.fn(() => q);
  q.limit = jest.fn(() => Promise.resolve(rows));
  q.then = (res: (v: unknown[]) => unknown) => Promise.resolve(rows).then(res);
  return q;
}

/** Db mock whose successive `select()` calls resolve the given row sets. */
function makeDb(...results: unknown[][]): PostgresJsDatabase<typeof schema> {
  const select = jest.fn();
  for (const rows of results) select.mockReturnValueOnce(query(rows));
  return { select } as unknown as PostgresJsDatabase<typeof schema>;
}

/** Settings whose `wow_forever_quest_import` switch reads `value`. */
function switchSettings(value: string | null): SettingsService {
  const get = jest.fn().mockResolvedValue(value);
  return { get } as unknown as SettingsService;
}
/**
 * The Blizzard quest import switched off (the overlay is ignored). A fresh
 * mock per call: `jest.resetAllMocks()` would blank a shared one (→ on).
 */
const off = (): SettingsService => switchSettings('false');

/** A `wow_dungeon_quest_blizzard` row as the overlay read selects it. */
function overlayRow(questId: number, title: string): Record<string, unknown> {
  return {
    questId,
    dungeonInstanceId: 226,
    title,
    typeId: 81,
    rewardXp: null,
    rewardMoneyCopper: null,
    rewardItems: [],
    reputations: [],
    requirementsRaw: null,
  };
}

const snapshot = (data: Record<string, unknown>) => ({
  data,
  capturedAt: CAPTURED,
});

const QUESTS = {
  completed: [5001, 99999],
  inProgress: [{ questId: 7, title: 'Log' }],
};

describe('CharacterQuestsService.getForCharacter', () => {
  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException when the character row is missing', async () => {
    const svc = new CharacterQuestsService(makeDb([]), off());
    await expect(svc.getForCharacter(CHAR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(sources).not.toHaveBeenCalled();
  });

  it('returns null when the character has no Forever snapshot', async () => {
    loader.mockResolvedValue(null);
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]), off());
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
    expect(builder).not.toHaveBeenCalled();
  });

  it('returns null for a schema-1 snapshot without quests', async () => {
    loader.mockResolvedValue(snapshot({ gear: [], lockouts: [] }));
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]), off());
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
    expect(builder).not.toHaveBeenCalled();
  });

  it('returns null when quests is malformed (not arrays)', async () => {
    loader.mockResolvedValue(
      snapshot({ quests: { completed: 'x', inProgress: [] } }),
    );
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]), off());
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
  });

  it('passes the quests slice, known rows and names into the builder', async () => {
    loader.mockResolvedValue(snapshot({ gear: [], quests: QUESTS }));
    const built = { marker: 'built' } as never;
    builder.mockReturnValue(built);
    jest.mocked(loadCharacterAttunements).mockResolvedValue([]);
    const svc = new CharacterQuestsService(
      makeDb([{ id: CHAR_ID }], [KNOWN_ROW]),
      off(),
    );
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toEqual({
      marker: 'built',
      attunements: [],
    });
    expect(sources).toHaveBeenCalledWith(expect.anything(), [CHAR_ID]);
    expect(builder).toHaveBeenCalledWith(
      {
        capturedAt: CAPTURED.toISOString(),
        quests: QUESTS,
        source: 'addon',
        inProgressSyncedAt: CAPTURED.toISOString(),
      },
      [expect.objectContaining({ questId: 5001, dungeonInstanceId: 226 })],
      instanceName,
    );
  });
});

describe('CharacterQuestsService.getForCharacter — Blizzard overlay (ROK-2143)', () => {
  beforeEach(() => jest.resetAllMocks());

  it('passes known rows with Blizzard titles and overlay-only quests when the import is on', async () => {
    loader.mockResolvedValue(snapshot({ quests: QUESTS }));
    const overlay = [
      overlayRow(5001, 'Known (Blizzard)'),
      overlayRow(5002, 'Only Blizzard'),
    ];
    const db = makeDb([{ id: CHAR_ID }], [KNOWN_ROW], overlay);
    await new CharacterQuestsService(db, switchSettings(null)).getForCharacter(
      CHAR_ID,
    );
    const known = builder.mock.calls[0]?.[1];
    expect(known?.map((q) => [q.questId, q.name])).toEqual([
      [5001, 'Known (Blizzard)'],
      [5002, 'Only Blizzard'],
    ]);
  });

  it('ignores the overlay (no overlay query) when the import is off', async () => {
    loader.mockResolvedValue(snapshot({ quests: QUESTS }));
    const db = makeDb([{ id: CHAR_ID }], [KNOWN_ROW]);
    await new CharacterQuestsService(db, off()).getForCharacter(CHAR_ID);
    expect(builder.mock.calls[0]?.[1]?.map((q) => q.name)).toEqual([
      'Known Quest',
    ]);
    expect(db.select).toHaveBeenCalledTimes(2);
  });
});

describe('CharacterQuestsService.getForCharacter — malformed slice', () => {
  beforeEach(() => jest.resetAllMocks());

  it.each([
    ['completed holds a string', { completed: [5001, 'x'], inProgress: [] }],
    [
      'a log entry has no questId',
      { completed: [], inProgress: [{ title: 'T' }] },
    ],
    [
      'an objective has no done flag',
      {
        completed: [],
        inProgress: [{ questId: 1, objectives: [{ text: 'a' }] }],
      },
    ],
  ])('returns null (no 500) when %s', async (_label, quests) => {
    loader.mockResolvedValue(snapshot({ quests }));
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]), off());
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
    expect(builder).not.toHaveBeenCalled();
  });
});
