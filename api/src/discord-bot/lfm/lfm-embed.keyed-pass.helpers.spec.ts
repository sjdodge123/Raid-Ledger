/**
 * ROK-2352 — the reconnect walk of the keyed pass: which games it visits.
 *
 * The walk reads through `deps.reconnectReads` (fakes here, no same-module
 * spies); `serialized` records the game and does not run the pass, so only
 * the game set is under test. The pass itself is `syncKeyedGroups`'s spec.
 */
import {
  reconcileKeyedGroups,
  type LfmKeyedPassDeps,
  type LfmKeyedReconnectReads,
} from './lfm-embed.keyed-pass.helpers';
import type { LfmMessageRow } from './lfm-embed.db-helpers';

const NOW = new Date('2026-11-25T12:00:00Z');
const openRow = (gameId: number, groupKey: string): LfmMessageRow =>
  ({ id: `r-${gameId}-${groupKey}`, gameId, groupKey }) as LfmMessageRow;

function harness(
  registry: boolean,
  open: LfmMessageRow[],
  keyedHandGames: number[],
) {
  const visited: number[] = [];
  const reads: LfmKeyedReconnectReads = {
    listOpen: jest.fn(() => Promise.resolve(open)),
    listKeyedHandGames: jest.fn(() => Promise.resolve(keyedHandGames)),
  };
  const deps: LfmKeyedPassDeps = {
    db: {} as never,
    registry: registry ? { getAdapter: jest.fn() } : undefined,
    postBudget: { trySpend: () => true },
    serialized: (gameId) => {
      visited.push(gameId);
      return Promise.resolve();
    },
    editRow: jest.fn(),
    postNew: jest.fn(),
    warn: jest.fn(),
    reconnectReads: reads,
  };
  return { deps, reads, visited };
}

describe('reconcileKeyedGroups — the reconnect game set', () => {
  it('visits a game whose keyed group reached LFM offline (no row yet)', async () => {
    const t = harness(true, [], [7]);
    await reconcileKeyedGroups(t.deps, NOW);
    expect(t.visited).toEqual([7]);
    expect(t.reads.listKeyedHandGames).toHaveBeenCalledWith(t.deps.db, NOW);
  });

  it('visits a game with an open keyed row and no live keyed hand (close it)', async () => {
    const t = harness(true, [openRow(9, 'dungeon:36')], []);
    await reconcileKeyedGroups(t.deps, NOW);
    expect(t.visited).toEqual([9]);
  });

  it("visits each game once, and never for a '' row alone", async () => {
    const t = harness(
      true,
      [openRow(7, 'dungeon:36'), openRow(7, 'dungeon:389'), openRow(3, '')],
      [7, 5],
    );
    await reconcileKeyedGroups(t.deps, NOW);
    expect(t.visited).toEqual([7, 5]);
  });

  it('reads nothing without a registry (specs that predate groups)', async () => {
    const t = harness(false, [openRow(9, 'dungeon:36')], [7]);
    await reconcileKeyedGroups(t.deps, NOW);
    expect(t.visited).toEqual([]);
    expect(t.reads.listOpen).not.toHaveBeenCalled();
    expect(t.reads.listKeyedHandGames).not.toHaveBeenCalled();
  });
});
