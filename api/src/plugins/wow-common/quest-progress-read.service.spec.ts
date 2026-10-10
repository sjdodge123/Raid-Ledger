import { Test } from '@nestjs/testing';
import { QuestProgressReadService } from './quest-progress-read.service';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { loadForeverEventProgress } from './event-forever-progress.query';
import type { ForeverEventProgress } from './event-forever-progress.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';

jest.mock('./event-forever-progress.query');
const mockLoad = jest.mocked(loadForeverEventProgress);

const AT = new Date('2026-10-02T00:00:00.000Z');
const CAPTURED = '2026-10-01T00:00:00.000Z';
const manualRow = (questId: number, pickedUp: boolean, completed: boolean) => ({
  id: 7,
  userId: 1,
  username: 'Roknua',
  questId,
  pickedUp,
  completed,
  updatedAt: AT,
});
const quest = (questId: number, prev: number | null): DungeonQuestDto =>
  ({
    questId,
    name: `Q${questId}`,
    dungeonInstanceId: prev === null ? null : 63,
    prevQuestId: prev,
    nextQuestId: null,
  }) as unknown as DungeonQuestDto;

/** User 1 (char-1): 100 completed, 200 in the log; quest 300 chains 100 → 300. */
function forever(): ForeverEventProgress {
  const q300 = quest(300, 100);
  const q100 = quest(100, null);
  return {
    eventQuests: [q300],
    lookup: new Map([
      [100, q100],
      [300, q300],
    ]),
    knownIds: new Set([100, 200, 300]),
    members: [
      {
        userId: 1,
        username: 'Roknua',
        characterId: 'char-1',
        snapshot: {
          quests: { completed: [100], inProgress: [{ questId: 200 }] },
          capturedAt: CAPTURED,
        },
      },
    ],
  };
}

let service: QuestProgressReadService;
let mockDb: MockDb;

beforeEach(async () => {
  mockDb = createDrizzleMock();
  mockLoad.mockReset().mockResolvedValue(null);
  const module = await Test.createTestingModule({
    providers: [
      QuestProgressReadService,
      { provide: DrizzleAsyncProvider, useValue: mockDb },
    ],
  }).compile();
  service = module.get(QuestProgressReadService);
});

describe('QuestProgressReadService — Classic (AC6)', () => {
  it('returns manual rows in the pre-1748 shape (no source/asOf/updatedAt)', async () => {
    mockDb.where.mockResolvedValueOnce([manualRow(2040, true, false)]);
    expect(await service.getProgressForEvent(10)).toEqual([
      {
        id: 7,
        eventId: 10,
        userId: 1,
        username: 'Roknua',
        questId: 2040,
        pickedUp: true,
        completed: false,
      },
    ]);
  });

  it('coverage groups picked-up rows without source', async () => {
    mockDb.where.mockResolvedValueOnce([
      manualRow(2040, true, false),
      manualRow(3001, false, true),
    ]);
    expect(await service.getCoverageForEvent(10)).toEqual([
      { questId: 2040, coveredBy: [{ userId: 1, username: 'Roknua' }] },
    ]);
  });

  it('prereqs are null for a non-Forever event', async () => {
    expect(await service.getPrereqsForViewer(10, 1)).toBeNull();
  });
});

describe('QuestProgressReadService — Forever', () => {
  beforeEach(() => mockLoad.mockResolvedValue(forever()));

  it('merges addon rows (id 0, source addon, asOf capturedAt) after manual rows', async () => {
    mockDb.where.mockResolvedValueOnce([manualRow(100, false, false)]);
    const rows = await service.getProgressForEvent(10);
    expect(rows).toEqual([
      expect.objectContaining({
        id: 7,
        questId: 100,
        completed: false,
        source: 'manual',
        asOf: AT.toISOString(),
      }),
      expect.objectContaining({
        id: 0,
        questId: 200,
        pickedUp: true,
        source: 'addon',
        asOf: CAPTURED,
        characterId: 'char-1',
        username: 'Roknua',
      }),
    ]);
  });

  it('coverage carries source/asOf for addon carriers', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    expect(await service.getCoverageForEvent(11)).toEqual([
      {
        questId: 200,
        coveredBy: [
          { userId: 1, username: 'Roknua', source: 'addon', asOf: CAPTURED },
        ],
      },
    ]);
  });

  it('prereqs: addon-completed step is done; a manual untick overrides it (D12)', async () => {
    mockDb.where.mockResolvedValueOnce([]);
    const done = await service.getPrereqsForViewer(10, 1);
    expect(done).toMatchObject({
      characterId: 'char-1',
      asOf: CAPTURED,
      neededTotal: 0,
    });
    expect(done?.quests[0]?.steps).toEqual([
      { questId: 100, name: 'Q100', done: true, source: 'addon' },
    ]);
    mockDb.where.mockResolvedValueOnce([manualRow(100, false, false)]);
    const unticked = await service.getPrereqsForViewer(10, 1);
    expect(unticked?.neededTotal).toBe(1);
    expect(unticked?.quests[0]?.steps[0]).toMatchObject({
      done: false,
      source: 'manual',
    });
  });

  it('prereqs are null for a viewer without a snapshot member', async () => {
    expect(await service.getPrereqsForViewer(10, 99)).toBeNull();
  });
});
