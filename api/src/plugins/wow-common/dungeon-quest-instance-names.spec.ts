/**
 * ROK-1745 / ROK-2210: quest views name an instance through the catalogue's
 * `instanceName` (was `dungeon-instance-names.ts`). Pins today's names for
 * every quest dataset id and the whole-dungeon quest names.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  instanceName,
  isCatalogueId,
} from './instance-catalogue/instance-catalogue';

const readQuests = (
  file: string,
): Array<{ dungeonInstanceId: number | null }> =>
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

describe('instanceName for the dungeon quest datasets', () => {
  it('names every dungeonInstanceId in the dungeon quest dataset', () => {
    expect(datasetIds.filter((id) => !isCatalogueId(id))).toEqual([]);
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

  // Unchanged from the retired JOURNAL_NAMES table.
  it.each([
    [63, 'Deadmines'],
    [64, 'Shadowfang Keep'],
    [226, 'Ragefire Chasm'],
    [227, 'Blackfathom Deeps'],
    [228, 'Blackrock Depths'],
    [229, 'Blackrock Spire'],
    [230, 'Dire Maul'],
    [231, 'Gnomeregan'],
    [232, 'Maraudon'],
    [233, 'Razorfen Downs'],
    [234, 'Razorfen Kraul'],
    [236, 'Stratholme'],
    [237, "The Temple of Atal'hakkar"],
    [238, 'The Stockade'],
    [239, 'Uldaman'],
    [240, 'Wailing Caverns'],
    [241, "Zul'Farrak"],
    [246, 'Scholomance'],
    [316, 'Scarlet Monastery'],
  ])('names journal id %i "%s"', (id, name) => {
    expect(instanceName(id)).toBe(name);
  });

  it('names Classic sub-instance wings', () => {
    expect(instanceName(31601)).toBe('SM: Graveyard');
    expect(instanceName(23203)).toBe('Maraudon: Pristine Waters');
  });

  // ROK-2210: these resolved to "Instance <id>" before the catalogue.
  it.each([
    [1276, 'Dire Maul - Warpwood Quarter'],
    [1277, 'Dire Maul - Gordok Commons'],
    [1292, 'Stratholme - Service Entrance'],
    [22901, 'Upper Blackrock Spire'],
  ])('names journal/new wing %i "%s"', (id, name) => {
    expect(instanceName(id)).toBe(name);
  });

  it('names Forever seed instances (ROK-1758; Q4 Blizzard spelling, ROK-2210)', () => {
    expect(instanceName(90000003)).toBe('Excavation Site: Wetlands');
    expect(instanceName(90000001)).toBe('The Hall of Thanes');
  });

  it('falls back to "Instance <id>" for an unknown id', () => {
    expect(instanceName(424242)).toBe('Instance 424242');
  });
});
