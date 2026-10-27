import { buildRecipeGraph, type RecipeGraph } from './valheim-recipes.graph';
import { resolveTree } from './valheim-recipes.resolve';
import {
  buildsOf,
  catalogRoots,
  responsePrefabs,
} from './valheim-recipes.service.helpers';
import { buildVisibleGraph } from './valheim-recipes.spoilers';
import * as stationSteps from './valheim-recipes.station-steps';
import {
  UPGRADER_TEST_STATION,
  upgraderRecipeRows,
} from './valheim-recipes.upgrader.testing';

/** ROK-1861 — the service's response shaping for steps + station builds. */
const CHEST = 'ArmorBronzeChest';
const q4 = { maxQuality: () => 4 };
const full = buildRecipeGraph(upgraderRecipeRows());

const treeAt = (graph: RecipeGraph, quality: number) =>
  resolveTree(
    graph,
    { prefab: CHEST, quality, amount: 1, fromQuality: 0 },
    null,
    q4,
  );

/** The cuirass made at no station, upgraded at the upgrader (q ≥ 2 only). */
function upgradeOnlyAtUpgrader() {
  const rows = upgraderRecipeRows();
  return buildRecipeGraph({
    ...rows,
    recipes: rows.recipes.map((r) =>
      r.result === CHEST ? { ...r, station: null } : r,
    ),
  });
}

/** Protected server: the cuirass + Bronze chain known, the upgrader NOT. */
const prunedWithout = (graph: RecipeGraph) =>
  buildVisibleGraph(graph, {
    recipes: new Set(['Recipe_ArmorBronzeChest', 'Recipe_Bronze', 'forge']),
    items: new Set(),
  });

describe('responsePrefabs', () => {
  it('names the nodes plus the upgrader build (station + its cost)', () => {
    const names = responsePrefabs(treeAt(full, 3));
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(
      expect.arrayContaining([CHEST, UPGRADER_TEST_STATION, 'Stone']),
    );
  });

  it('a q1 craft names no build', () => {
    expect(responsePrefabs(treeAt(full, 1))).not.toContain('Stone');
  });
});

describe('buildsOf', () => {
  it('a q3 craft carries the upgrader piece cost', () => {
    expect(buildsOf(treeAt(full, 3))).toEqual({
      stationBuilds: {
        [UPGRADER_TEST_STATION]: [
          { prefab: 'Stone', amount: 10 },
          { prefab: 'Bronze', amount: 2 },
        ],
      },
    });
  });

  it('omits the key when nothing is built', () => {
    expect(buildsOf(treeAt(full, 1))).toEqual({});
  });
});

describe('catalogRoots', () => {
  it('adds every upgrade station the graph can build', () => {
    expect(catalogRoots(full, [CHEST])).toEqual([CHEST, UPGRADER_TEST_STATION]);
  });

  it('adds nothing when the upgrader is not a piece', () => {
    const noPiece = buildRecipeGraph({ ...upgraderRecipeRows(), pieces: [] });
    expect(catalogRoots(noPiece, [CHEST])).toEqual([CHEST]);
  });

  it('asks isUpgraderStation, the single detection point', () => {
    const spy = jest
      .spyOn(stationSteps, 'isUpgraderStation')
      .mockReturnValue(false);
    try {
      expect(catalogRoots(full, [CHEST])).toEqual([CHEST]);
      expect(spy).toHaveBeenCalledWith(full, UPGRADER_TEST_STATION);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('an undiscovered upgrade station (ROK-1948 ruling)', () => {
  const pruned = prunedWithout(upgradeOnlyAtUpgrader());

  it('is pruned from the graph the service resolves on', () => {
    expect(pruned.stations.has(UPGRADER_TEST_STATION)).toBe(false);
    expect(catalogRoots(pruned, [CHEST])).toEqual([CHEST]);
  });

  it('never reaches stationBuilds or the names lookup', () => {
    const res = treeAt(pruned, 3);
    expect(buildsOf(res)).toEqual({});
    expect(responsePrefabs(res)).not.toContain(UPGRADER_TEST_STATION);
    expect(responsePrefabs(res)).not.toContain('Stone');
  });

  it('is listed once someone has discovered it', () => {
    const graph = upgradeOnlyAtUpgrader();
    const known = buildVisibleGraph(graph, {
      recipes: new Set([
        'Recipe_ArmorBronzeChest',
        'Recipe_Bronze',
        'forge',
        UPGRADER_TEST_STATION,
      ]),
      items: new Set(),
    });
    expect(Object.keys(buildsOf(treeAt(known, 3)).stationBuilds ?? {})).toEqual(
      [UPGRADER_TEST_STATION],
    );
  });
});
