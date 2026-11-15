/**
 * ROK-1908: the Forever-new instances' quest areas, derived from the
 * instance catalogue (never a hand-written id → area map).
 */
import { CLASSIC_QUEST_AREAS, areaNameMatches } from './classic-quest-areas';
import {
  foreverQuestAreaTargets,
  primaryQuestArea,
  questAreaTargets,
  type QuestAreaTarget,
} from './forever-quest-areas';

const DALARAN = 90_000_004;
/** Probe 2026-11-15 (`quest/area/index`, static-forever-us). */
const PROBED_FOREVER_AREAS: readonly [number, number][] = [
  [90_000_001, 16919],
  [90_000_002, 16611],
  [90_000_003, 16732],
  [DALARAN, 16544],
  [DALARAN, 16560],
  [90_000_005, 16550],
  [90_000_006, 16842],
  [90_000_007, 16620],
  [90_000_008, 16554],
  [90_000_009, 16985],
  [90_000_010, 16871],
  [90_000_011, 16597],
];

function pairs(targets: readonly QuestAreaTarget[]): [number, number][] {
  return targets.map((t) => [t.instanceId, t.entry.areaId]);
}

describe('foreverQuestAreaTargets (ROK-1908)', () => {
  it('lists every Forever-new quest area, both Dalaran areas included', () => {
    expect(pairs(foreverQuestAreaTargets())).toEqual(PROBED_FOREVER_AREAS);
  });

  it('never crawls area 279 (Dalaran city quests stay prerequisites)', () => {
    const areaIds = questAreaTargets().map((t) => t.entry.areaId);
    expect(areaIds).not.toContain(279);
  });

  it('accepts the Blizzard area names the probe saw', () => {
    const byArea = new Map(
      foreverQuestAreaTargets().map((t) => [t.entry.areaId, t.entry]),
    );
    const seen: [number, string][] = [
      [16544, 'City of Dalaran'],
      [16560, 'City of Dalaran'],
      [16871, 'The Barrow Deeps'],
      [16985, "The Shaper's Terrace"],
      [16842, "Krol'dok Stronghold"],
    ];
    for (const [areaId, name] of seen) {
      const entry = byArea.get(areaId);
      expect({ areaId, matches: entry ? areaNameMatches(entry, name) : null })
        .toEqual({ areaId, matches: true });
    }
  });
});

describe('questAreaTargets (ROK-1908)', () => {
  it('is the 19 classic dungeons then the Forever-new areas, ids distinct', () => {
    const targets = questAreaTargets();
    const classic = Object.keys(CLASSIC_QUEST_AREAS).length;
    expect(targets).toHaveLength(classic + PROBED_FOREVER_AREAS.length);
    const areaIds = targets.map((t) => t.entry.areaId);
    expect(new Set(areaIds).size).toBe(areaIds.length);
  });
});

describe('primaryQuestArea (ROK-1908)', () => {
  it("is an instance's first catalogue area, else null", () => {
    expect(primaryQuestArea(DALARAN)?.areaId).toBe(16544);
    expect(primaryQuestArea(234)?.areaId).toBe(CLASSIC_QUEST_AREAS[234]?.areaId);
    expect(primaryQuestArea(1)).toBeNull();
  });
});
