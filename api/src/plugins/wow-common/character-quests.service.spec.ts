/**
 * ROK-1745: unit tests for CharacterQuestsService (db, loader and the pure
 * builder are mocked; the real builder is covered by its own spec).
 */
import { NotFoundException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { CharacterQuestsService } from './character-quests.service';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';
import { buildCharacterQuests } from './character-quests.helpers';
import { instanceName } from './dungeon-instance-names';

jest.mock('./forever-char-snapshot.query');
jest.mock('./character-quests.helpers');

const CHAR_ID = '6f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f';
const CAPTURED = new Date('2026-10-01T12:00:00.000Z');
const loader = jest.mocked(loadForeverCharSnapshot);
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

const snapshot = (data: Record<string, unknown>) =>
  ({ data, capturedAt: CAPTURED }) as unknown as Awaited<
    ReturnType<typeof loadForeverCharSnapshot>
  >;

const QUESTS = {
  completed: [5001, 99999],
  inProgress: [{ questId: 7, title: 'Log' }],
};

describe('CharacterQuestsService.getForCharacter', () => {
  beforeEach(() => jest.resetAllMocks());

  it('throws NotFoundException when the character row is missing', async () => {
    const svc = new CharacterQuestsService(makeDb([]));
    await expect(svc.getForCharacter(CHAR_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns null when the character has no Forever snapshot', async () => {
    loader.mockResolvedValue(undefined);
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]));
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
    expect(builder).not.toHaveBeenCalled();
  });

  it('returns null for a schema-1 snapshot without quests', async () => {
    loader.mockResolvedValue(snapshot({ gear: [], lockouts: [] }));
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]));
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
    expect(builder).not.toHaveBeenCalled();
  });

  it('returns null when quests is malformed (not arrays)', async () => {
    loader.mockResolvedValue(
      snapshot({ quests: { completed: 'x', inProgress: [] } }),
    );
    const svc = new CharacterQuestsService(makeDb([{ id: CHAR_ID }]));
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBeNull();
  });

  it('passes the quests slice, known rows and names into the builder', async () => {
    loader.mockResolvedValue(snapshot({ gear: [], quests: QUESTS }));
    const built = { marker: 'built' } as never;
    builder.mockReturnValue(built);
    const svc = new CharacterQuestsService(
      makeDb([{ id: CHAR_ID }], [KNOWN_ROW]),
    );
    await expect(svc.getForCharacter(CHAR_ID)).resolves.toBe(built);
    expect(loader).toHaveBeenCalledWith(expect.anything(), CHAR_ID);
    expect(builder).toHaveBeenCalledWith(
      { capturedAt: CAPTURED.toISOString(), quests: QUESTS },
      [expect.objectContaining({ questId: 5001, dungeonInstanceId: 226 })],
      instanceName,
    );
  });
});
