/**
 * ROK-1948 D5 — the pruned-graph cache key is server + recipe set (id and
 * import time) + the server's profile fingerprint. No viewer term: the
 * function has no viewer input, so two readers of one server share a build.
 */
import type { ValheimRecipeSetRow } from '../../../../drizzle/schema';
import { RECIPES_DEMO_MESSAGE as DEMO } from '../valheim-armory-recipes-demo-fixture';
import { buildRecipeGraph } from './valheim-recipes.graph';
import {
  VisibleGraphCache,
  visibleRecipes,
  type SpoilerReader,
} from './valheim-recipes.spoilers.cache';

const full = buildRecipeGraph(DEMO);

function setRow(over: Partial<ValheimRecipeSetRow> = {}): ValheimRecipeSetRow {
  return {
    id: 7,
    pelicanServerId: 3,
    gameVersion: DEMO.gameVersion,
    locale: 'English',
    capturedAt: new Date('2026-10-17T20:15:00Z'),
    atlasSha256: null,
    atlasWidth: null,
    atlasHeight: null,
    sourceSnapshotId: null,
    importedAt: new Date('2026-10-24T10:00:00Z'),
    ...over,
  };
}

/** A reader whose fingerprint the test moves; counts list reads (= builds). */
function reader(known: string[]) {
  const state = { fingerprint: '1:100', builds: 0, known };
  const r: SpoilerReader = {
    profileFingerprint: () => Promise.resolve(state.fingerprint),
    serverKnownLists: () => {
      state.builds += 1;
      return Promise.resolve([{ knownRecipes: state.known, knownItems: [] }]);
    },
  };
  return { r, state };
}

describe('visibleRecipes cache key (ROK-1948 D5)', () => {
  it('repeat reads of one server + set + fingerprint share one build', async () => {
    const cache = new VisibleGraphCache();
    const { r, state } = reader(['piece_workbench', 'Club']);
    const a = await visibleRecipes(cache, r, setRow(), full);
    const b = await visibleRecipes(cache, r, setRow(), full);
    expect(state.builds).toBe(1);
    expect(b).toBe(a);
    expect(a.spoilers).toBe('protected');
    expect([...a.graph.recipesByResult.keys()]).toEqual(['Club']);
  });

  it('a new profile upload (fingerprint moves) rebuilds with the new lists', async () => {
    const cache = new VisibleGraphCache();
    const { r, state } = reader(['piece_workbench', 'Club']);
    await visibleRecipes(cache, r, setRow(), full);
    state.known = ['piece_workbench', 'Club', 'forge', 'Recipe_Bronze'];
    state.fingerprint = '1:200';
    const next = await visibleRecipes(cache, r, setRow(), full);
    expect(state.builds).toBe(2);
    expect([...next.graph.recipesByResult.keys()].sort()).toEqual([
      'Bronze',
      'Club',
    ]);
  });

  it('a different server, set id or set import time each gets its own entry', async () => {
    const cache = new VisibleGraphCache();
    const { r, state } = reader(['piece_workbench', 'Club']);
    await visibleRecipes(cache, r, setRow(), full);
    await visibleRecipes(cache, r, setRow({ pelicanServerId: 4 }), full);
    await visibleRecipes(cache, r, setRow({ id: 8 }), full);
    await visibleRecipes(
      cache,
      r,
      setRow({ importedAt: new Date('2026-10-24T11:00:00Z') }),
      full,
    );
    expect(state.builds).toBe(4);
    expect(cache.size).toBe(4);
  });
});
