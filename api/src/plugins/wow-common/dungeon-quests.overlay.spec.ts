/**
 * ROK-2143 — the read-path overlay: Blizzard values win field by field,
 * curated fields survive, overlay-only quests are appended (R4), and the
 * kill switch off returns the bundled rows untouched (AC6).
 */
import type { WowDungeonQuestBlizzardRow } from '../../drizzle/schema';
import { listBlizzardOverlay } from './forever-quest-import/blizzard-quest.repo';
import {
  applyInstanceOverlay,
  applyQuestOverlay,
  type QuestOverlayDeps,
} from './dungeon-quests.overlay';
import type { DungeonQuestDto } from './dungeon-quests.types';

jest.mock('./forever-quest-import/blizzard-quest.repo', () => ({
  listBlizzardOverlay: jest.fn(),
}));
const listOverlay = jest.mocked(listBlizzardOverlay);

function curated(questId: number): DungeonQuestDto {
  return {
    questId,
    dungeonInstanceId: 238,
    name: 'Curated Name',
    questLevel: 25,
    requiredLevel: 22,
    expansion: 'classic',
    questGiverNpc: 'Motley Garmason',
    questGiverZone: null,
    prevQuestId: null,
    nextQuestId: null,
    rewardsJson: [1],
    objectives: 'Kill things',
    classRestriction: null,
    raceRestriction: null,
    startsInsideDungeon: false,
    sharable: true,
    rewardXp: null,
    rewardGold: null,
    rewardType: 'none',
  };
}

function overlay(
  questId: number,
  dungeonInstanceId: number | null = 238,
  extra: Partial<WowDungeonQuestBlizzardRow> = {},
): WowDungeonQuestBlizzardRow {
  return {
    questId,
    areaId: 717,
    dungeonInstanceId,
    title: `Blizzard ${questId}`,
    typeId: 81,
    rewardXp: 5750,
    rewardMoneyCopper: 1800,
    rewardItems: [{ id: 918, name: 'Deviate Hide Pack' }],
    reputations: [],
    requirementsRaw: null,
    raw: {},
    fetchedAt: new Date('2026-11-09T00:00:00Z'),
    runId: 'run-1',
    ...extra,
  };
}

/** Deps whose extras query resolves `extras`; `switchValue` is the stored setting. */
function deps(
  switchValue: string | null,
  extras: WowDungeonQuestBlizzardRow[] = [],
) {
  const where = jest.fn().mockResolvedValue(extras);
  const select = jest.fn(() => ({ from: () => ({ where }) }));
  const value = {
    db: { select },
    settings: { get: jest.fn().mockResolvedValue(switchValue) },
  };
  return { value: value as unknown as QuestOverlayDeps, select };
}

const SCOPE = { instanceIds: [238], expansions: ['classic'] };

beforeEach(() => listOverlay.mockReset());

describe('applyInstanceOverlay', () => {
  it('lets Blizzard win for name/xp/money/items and keeps every curated field (AC5)', async () => {
    listOverlay.mockResolvedValue(new Map([[378, overlay(378)]]));
    const [dto] = await applyInstanceOverlay(
      deps(null).value,
      [curated(378)],
      SCOPE,
    );
    expect(dto).toMatchObject({
      name: 'Blizzard 378',
      rewardXp: 5750,
      rewardGold: 1800,
      rewardsJson: [918],
      questGiverNpc: 'Motley Garmason',
      startsInsideDungeon: false,
      objectives: 'Kill things',
      requiredLevel: 22,
      questLevel: 25,
    });
  });

  it('returns the bundled rows untouched and queries nothing when the switch is off (AC6)', async () => {
    const d = deps('false', [overlay(999)]);
    const rows = [curated(378)];
    expect(await applyInstanceOverlay(d.value, rows, SCOPE)).toBe(rows);
    expect(listOverlay).not.toHaveBeenCalled();
    expect(d.select).not.toHaveBeenCalled();
  });

  it('appends an overlay-only quest for the dungeon (R4) and skips ones we already have', async () => {
    listOverlay.mockResolvedValue(new Map());
    const d = deps(null, [overlay(378), overlay(386)]);
    const out = await applyInstanceOverlay(d.value, [curated(378)], SCOPE);
    expect(out.map((q) => q.questId)).toEqual([378, 386]);
    expect(out[1]).toMatchObject({
      name: 'Blizzard 386',
      dungeonInstanceId: 238,
      expansion: 'classic',
      questGiverNpc: null,
      prevQuestId: null,
      rewardXp: 5750,
      rewardGold: 1800,
      rewardsJson: [918],
      startsInsideDungeon: false,
    });
  });

  it('adds no overlay-only quests for a variant without classic content', async () => {
    listOverlay.mockResolvedValue(new Map());
    const d = deps(null, [overlay(386)]);
    const out = await applyInstanceOverlay(d.value, [], {
      instanceIds: [238],
      expansions: ['tbc'],
    });
    expect(out).toEqual([]);
    expect(d.select).not.toHaveBeenCalled();
  });
});

describe('applyQuestOverlay', () => {
  it('merges chain quests when on and is a no-op when off', async () => {
    listOverlay.mockResolvedValue(new Map([[378, overlay(378)]]));
    const [on] = await applyQuestOverlay(deps(null).value, [curated(378)]);
    expect(on?.name).toBe('Blizzard 378');
    const rows = [curated(378)];
    expect(await applyQuestOverlay(deps('false').value, rows)).toBe(rows);
  });
});

describe('overlay-only quests (m5 type gate, m6 reward type, L6 requirements)', () => {
  it('appends only Dungeon (81) and Group (1) types — not Raid (62) or untyped', async () => {
    listOverlay.mockResolvedValue(new Map());
    const d = deps(null, [
      overlay(386, 238, { typeId: 81 }),
      overlay(387, 238, { typeId: 1 }),
      overlay(388, 238, { typeId: 62 }),
      overlay(389, 238, { typeId: null }),
    ]);
    const out = await applyInstanceOverlay(d.value, [], SCOPE);
    expect(out.map((q) => q.questId)).toEqual([386, 387]);
  });

  it('gives an overlay-only quest with one reward item rewardType "choice", like curated rows', async () => {
    listOverlay.mockResolvedValue(new Map());
    const d = deps(null, [
      overlay(386),
      overlay(387, 238, { rewardItems: [] }),
    ]);
    const out = await applyInstanceOverlay(d.value, [], SCOPE);
    expect(out.map((q) => [q.questId, q.rewardType])).toEqual([
      [386, 'choice'],
      [387, 'none'],
    ]);
  });

  it('maps requirements onto an overlay-only quest', async () => {
    listOverlay.mockResolvedValue(new Map());
    const requirementsRaw = {
      faction: { name: 'Alliance', type: 'ALLIANCE' },
      classes: [{ id: 2, name: 'Paladin' }],
      quests: { operator: { type: 'AND' }, conditions: [{ id: 303 }] },
    };
    const d = deps(null, [overlay(386, 238, { requirementsRaw })]);
    const [dto] = await applyInstanceOverlay(d.value, [], SCOPE);
    expect(dto).toMatchObject({
      prevQuestId: 303,
      classRestriction: ['Paladin'],
      raceRestriction: ['Gnome', 'Night Elf', 'Dwarf', 'Human'],
      requiredLevel: null,
    });
  });
});
