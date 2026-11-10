/**
 * ROK-2143 — unit spec for the Blizzard quest overlay repo helpers: chunked
 * upsert keyed on quest_id, the full replace-on-conflict set, overlay map
 * reads and stale-row listing. The DB is the shared chain mock; the real SQL
 * is covered by the L3 integration spec.
 */
import { getTableColumns } from 'drizzle-orm';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import {
  wowDungeonQuestBlizzard,
  type WowDungeonQuestBlizzardInsert,
  type WowDungeonQuestBlizzardRow,
} from '../../../drizzle/schema';
import {
  BLIZZARD_QUEST_UPSERT_CHUNK,
  blizzardQuestConflictSet,
  latestBlizzardOverlayFetchedAt,
  listBlizzardOverlay,
  listStaleQuestIds,
  upsertBlizzardQuests,
} from './blizzard-quest.repo';

type Db = Parameters<typeof upsertBlizzardQuests>[0];

const NOW = new Date('2026-11-09T12:00:00Z');

function asDb(db: MockDb): Db {
  return db as unknown as Db;
}

function row(questId: number, title = `Quest ${questId}`) {
  const insert: WowDungeonQuestBlizzardInsert = {
    questId,
    areaId: 1581,
    dungeonInstanceId: 63,
    title,
    raw: { id: questId },
    fetchedAt: NOW,
    runId: 'run-1',
  };
  return insert;
}

function stored(questId: number): WowDungeonQuestBlizzardRow {
  return {
    questId,
    areaId: 1581,
    dungeonInstanceId: 63,
    title: `Quest ${questId}`,
    typeId: null,
    rewardXp: 450,
    rewardMoneyCopper: 1200,
    rewardItems: [],
    reputations: [],
    requirementsRaw: null,
    raw: { id: questId },
    fetchedAt: NOW,
    runId: 'run-1',
  };
}

describe('upsertBlizzardQuests', () => {
  it('writes nothing and returns 0 for an empty batch', async () => {
    const db = createDrizzleMock();
    expect(await upsertBlizzardQuests(asDb(db), [])).toBe(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('upserts on quest_id, keeping the last row for a repeated quest', async () => {
    const db = createDrizzleMock();
    const written = await upsertBlizzardQuests(asDb(db), [
      row(1, 'old'),
      row(2),
      row(1, 'new'),
    ]);
    expect(written).toBe(2);
    expect(db.insert).toHaveBeenCalledWith(wowDungeonQuestBlizzard);
    expect(db.values).toHaveBeenCalledWith([row(1, 'new'), row(2)]);
    expect(db.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: wowDungeonQuestBlizzard.questId }),
    );
  });

  it('splits a large batch into chunks', async () => {
    const db = createDrizzleMock();
    const rows = Array.from(
      { length: BLIZZARD_QUEST_UPSERT_CHUNK + 1 },
      (_, i) => row(i + 1),
    );
    expect(await upsertBlizzardQuests(asDb(db), rows)).toBe(rows.length);
    expect(db.insert).toHaveBeenCalledTimes(2);
  });
});

describe('blizzardQuestConflictSet', () => {
  it('replaces every non-key column, including fetched_at and run_id', () => {
    const keys = Object.keys(blizzardQuestConflictSet()).sort();
    const columns = Object.keys(getTableColumns(wowDungeonQuestBlizzard))
      .filter((k) => k !== 'questId')
      .sort();
    expect(keys).toEqual(columns);
    expect(keys).toEqual(expect.arrayContaining(['fetchedAt', 'runId']));
  });
});

describe('listBlizzardOverlay', () => {
  it('returns an empty map without querying for an empty id list', async () => {
    const db = createDrizzleMock();
    expect((await listBlizzardOverlay(asDb(db), [])).size).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('maps the whole table by quest id when no ids are given', async () => {
    const db = createDrizzleMock();
    db.from.mockResolvedValueOnce([stored(1), stored(2)]);
    const map = await listBlizzardOverlay(asDb(db));
    expect([...map.keys()]).toEqual([1, 2]);
    expect(map.get(2)?.rewardXp).toBe(450);
    expect(db.where).not.toHaveBeenCalled();
  });

  it('filters by the given quest ids', async () => {
    const db = createDrizzleMock();
    db.where.mockResolvedValueOnce([stored(7)]);
    const map = await listBlizzardOverlay(asDb(db), [7, 7, 8]);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(map.get(7)?.questId).toBe(7);
    expect(map.has(8)).toBe(false);
  });
});

describe('listStaleQuestIds', () => {
  it('returns the quest ids another run wrote', async () => {
    const db = createDrizzleMock();
    db.orderBy.mockResolvedValueOnce([{ questId: 3 }, { questId: 9 }]);
    expect(await listStaleQuestIds(asDb(db), 'run-2')).toEqual([3, 9]);
    expect(db.where).toHaveBeenCalledTimes(1);
  });
});

describe('latestBlizzardOverlayFetchedAt (ROK-2144 AC8)', () => {
  it('returns the newest fetched_at over the whole overlay', async () => {
    const db = createDrizzleMock();
    db.from.mockResolvedValueOnce([{ latest: NOW }]);
    expect(await latestBlizzardOverlayFetchedAt(asDb(db))).toEqual(NOW);
    expect(db.from).toHaveBeenCalledWith(wowDungeonQuestBlizzard);
    expect(db.where).not.toHaveBeenCalled();
  });

  it('returns null when the overlay is empty (never imported)', async () => {
    const db = createDrizzleMock();
    db.from.mockResolvedValueOnce([{ latest: null }]);
    expect(await latestBlizzardOverlayFetchedAt(asDb(db))).toBeNull();
  });

  it('returns null when the driver yields no row', async () => {
    const db = createDrizzleMock();
    db.from.mockResolvedValueOnce([]);
    expect(await latestBlizzardOverlayFetchedAt(asDb(db))).toBeNull();
  });
});
