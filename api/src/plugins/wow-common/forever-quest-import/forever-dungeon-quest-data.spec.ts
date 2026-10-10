import { readFileSync } from 'fs';
import { join } from 'path';
import { FOREVER_INSTANCES } from '../forever-instance-data';

const rows = JSON.parse(
  readFileSync(
    join(__dirname, '../data/forever-dungeon-quest-data.json'),
    'utf-8',
  ),
) as Array<{
  questId: number;
  dungeonInstanceId: number | null;
  questLevel: number | null;
}>;

describe('shipped forever-dungeon-quest-data.json', () => {
  it('is sorted by questId', () => {
    const ids = rows.map((r) => r.questId);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('keys no row more than 5 levels above its instance band max', () => {
    const outOfBand = rows.filter((r) => {
      const max = FOREVER_INSTANCES.find(
        (i) => i.id === r.dungeonInstanceId,
      )?.maximumLevel;
      return (
        max !== undefined && r.questLevel !== null && r.questLevel > max + 5
      );
    });
    expect(outOfBand.map((r) => r.questId)).toEqual([]);
  });

  it('keys the Dalaran chain tails to City of Dalaran', () => {
    const instanceOf = (id: number): number | null | undefined =>
      rows.find((r) => r.questId === id)?.dungeonInstanceId;
    expect(instanceOf(92459)).toBe(90000004);
    expect(instanceOf(97287)).toBe(90000004);
  });
});
