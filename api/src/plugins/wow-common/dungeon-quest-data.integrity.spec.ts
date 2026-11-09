/**
 * ROK-2143 — bundled classic quest data integrity.
 * R7: no synthetic XP/money pattern remains (the old generator wrote
 * 45 at lvl 1 / 10×lvl+45 to lvl 28 / 15×lvl XP, and 25/50/100×lvl copper
 * tiered at lvl 20/40). Every `prevQuestId` resolves to a bundled row or is a
 * known gap — the list must shrink, never grow.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { DUNGEON_INSTANCE_NAMES } from './dungeon-instance-names';

interface Row {
  questId: number;
  dungeonInstanceId: number | null;
  questLevel: number | null;
  questGiverZone: string | null;
  prevQuestId: number | string | null;
  rewardXp: number | null;
  rewardGold: number | null;
}

const rows = JSON.parse(
  readFileSync(join(__dirname, 'data', 'dungeon-quest-data.json'), 'utf-8'),
) as Row[];

const synthXp = (l: number) => (l === 1 ? 45 : l <= 28 ? 10 * l + 45 : 15 * l);
const synthGold = (l: number) => (l <= 20 ? 25 : l <= 40 ? 50 : 100) * l;

/** Quests whose prerequisite is not in the bundled data (ROK-2143 audit). */
const KNOWN_PREREQ_GAPS: readonly number[] = [
  5728, 214, 1491, 1653, 166, 914, 1275, 378, 391, 1101, 721, 1951, 1956, 1139,
  2936, 2991, 3527, 1445, 1475, 3446, 4143, 8232, 8236, 8253, 8257, 8413, 8418,
  8422, 8425, 9053, 3528, 4148, 4241, 4024, 4063, 4788, 4341, 5127, 5463, 5466,
  5522, 5526, 5848, 6163, 7642, 7647, 7737, 8258, 8926, 8927, 8931, 8932, 8933,
  8934, 8935, 8936, 8937, 8938, 8939, 8940, 8941, 8942, 8943, 8944, 8948, 8966,
  8967, 8968, 8969, 8989, 8990, 8991, 8992, 8999, 9000, 9001, 9002, 9003, 9004,
  9005, 9006, 9007, 9008, 9009, 9010, 9011, 9012, 9013, 9014, 9257, 9269, 9270,
  9271, 1160, 1053,
];

describe('bundled classic dungeon quest data (ROK-2143)', () => {
  it('carries no synthetic XP value (R7)', () => {
    const synthetic = rows
      .filter(
        (r) =>
          r.rewardXp !== null &&
          r.questLevel !== null &&
          r.rewardXp === synthXp(r.questLevel),
      )
      .map((r) => r.questId);
    expect(synthetic).toEqual([]);
  });

  it('carries no synthetic money value (R7)', () => {
    const synthetic = rows
      .filter(
        (r) =>
          r.rewardGold !== null &&
          r.questLevel !== null &&
          r.rewardGold === synthGold(r.questLevel),
      )
      .map((r) => r.questId);
    expect(synthetic).toEqual([]);
  });

  it("never names the quest's own dungeon as its giver zone (R5=B)", () => {
    const own = rows
      .filter(
        (r) =>
          r.dungeonInstanceId !== null &&
          r.questGiverZone === DUNGEON_INSTANCE_NAMES[r.dungeonInstanceId],
      )
      .map((r) => r.questId);
    expect(own).toEqual([]);
  });

  it('every prevQuestId resolves to a bundled row or is a listed known gap', () => {
    const ids = new Set(rows.map((r) => r.questId));
    const dangling = rows
      .filter((r) => r.prevQuestId !== null && !ids.has(Number(r.prevQuestId)))
      .map((r) => r.questId)
      .sort((a, b) => a - b);
    expect(dangling).toEqual([...KNOWN_PREREQ_GAPS].sort((a, b) => a - b));
  });

  it('no quest is its own prerequisite', () => {
    expect(rows.filter((r) => Number(r.prevQuestId) === r.questId)).toEqual([]);
  });
});
