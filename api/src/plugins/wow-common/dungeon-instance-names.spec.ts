import { readFileSync } from 'fs';
import { join } from 'path';
import { DUNGEON_INSTANCE_NAMES, instanceName } from './dungeon-instance-names';

const questData = JSON.parse(
  readFileSync(join(__dirname, 'data', 'dungeon-quest-data.json'), 'utf8'),
) as Array<{ dungeonInstanceId: number | null }>;

const datasetIds = [
  ...new Set(
    questData
      .map((q) => q.dungeonInstanceId)
      .filter((id): id is number => id !== null),
  ),
];

describe('DUNGEON_INSTANCE_NAMES', () => {
  it('names every dungeonInstanceId in the dungeon quest dataset', () => {
    const missing = datasetIds.filter((id) => !DUNGEON_INSTANCE_NAMES[id]);
    expect(missing).toEqual([]);
    expect(datasetIds.length).toBeGreaterThan(0);
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

  it('falls back to "Instance <id>" for an unknown id', () => {
    expect(instanceName(424242)).toBe('Instance 424242');
  });
});
