import { readFileSync } from 'fs';
import { join } from 'path';
import { DUNGEON_INSTANCE_NAMES, instanceName } from './dungeon-instance-names';
import { findForeverSeedInstance } from './forever-instance-data';

const readQuests = (file: string): Array<{ dungeonInstanceId: number | null }> =>
  JSON.parse(readFileSync(join(__dirname, 'data', file), 'utf8')) as Array<{
    dungeonInstanceId: number | null;
  }>;

// ROK-1758: the Forever rows (seed ids 90000001+) ride the same seeder.
const questData = [
  ...readQuests('dungeon-quest-data.json'),
  ...readQuests('forever-dungeon-quest-data.json'),
];

const datasetIds = [
  ...new Set(
    questData
      .map((q) => q.dungeonInstanceId)
      .filter((id): id is number => id !== null),
  ),
];

describe('DUNGEON_INSTANCE_NAMES', () => {
  it('names every dungeonInstanceId in the dungeon quest dataset', () => {
    const missing = datasetIds.filter(
      (id) => !DUNGEON_INSTANCE_NAMES[id] && !findForeverSeedInstance(id),
    );
    expect(missing).toEqual([]);
    expect(datasetIds.length).toBeGreaterThan(0);
  });

  it('includes the Forever dataset ids in the guard', () => {
    expect(datasetIds).toEqual(expect.arrayContaining([90000001, 90000004]));
  });

  it('never resolves a dataset id to the fallback label', () => {
    const fallbacks = datasetIds.filter((id) =>
      instanceName(id).startsWith('Instance '),
    );
    expect(fallbacks).toEqual([]);
  });

  it('names Classic sub-instance wings from CLASSIC_SUB_INSTANCES', () => {
    expect(instanceName(31601)).toBe('SM: Graveyard');
    expect(instanceName(23203)).toBe('Maraudon: Pristine Waters');
  });

  it('names Forever seed instances from FOREVER_INSTANCES (ROK-1758)', () => {
    expect(instanceName(90000003)).toBe('Excavation Site: Wetlands');
    expect(instanceName(90000001)).toBe('Hall of Thanes');
  });

  it('falls back to "Instance <id>" for an unknown id', () => {
    expect(instanceName(424242)).toBe('Instance 424242');
  });
});
