/**
 * Unit specs for the pure Forever talents adapter (ROK-1744 L0).
 * Grid rule: LedgerLink TalentGrid.lua (PR #25) — gap > 2000 splits sub-trees,
 * col = round((posX − cluster min) / 600), row = round((posY − 2130) / 600).
 */
import {
  snapshotToForeverTalents,
  type ForeverTalentNodeInput,
  type ForeverTalentSnapshotInput,
} from './forever-talents.adapter';

const CAPTURED_AT = '2026-10-09T21:00:00.000Z';
const ORIGINS = [1020, 5020, 9080];

interface Cell {
  tree: number;
  col: number;
  row: number;
}

/** posX/posY for a (tree,col,row) cell on the shared Forever coordinate set. */
function pos(c: Cell, xOffset = 0): { posX: number; posY: number } {
  return { posX: ORIGINS[c.tree]! + c.col * 600 + xOffset, posY: 2130 + c.row * 600 };
}

/** Every cell of the vanilla 3 trees × 4 cols × 7 rows layout. */
function allCells(): Cell[] {
  const cells: Cell[] = [];
  for (let tree = 0; tree < 3; tree++)
    for (let col = 0; col < 4; col++)
      for (let row = 0; row < 7; row++) cells.push({ tree, col, row });
  return cells;
}

/** Positioned node per cell; rank = tree + 1 so spent sums are distinct. */
function positioned(cells: Cell[]): ForeverTalentNodeInput[] {
  return cells.map((c, i) => ({
    nodeId: 1000 + i,
    rank: c.tree + 1,
    maxRanks: 5,
    entryId: 9000 + i,
    ...pos(c),
  }));
}

function snap(nodes: ForeverTalentNodeInput[]): ForeverTalentSnapshotInput {
  return { capturedAt: CAPTURED_AT, configId: 7, importString: 'abc', nodes };
}

describe('snapshotToForeverTalents — derived grid', () => {
  it('derives tree/row/col for a full Warrior-like 3×4×7 grid', () => {
    const cells = allCells();
    const out = snapshotToForeverTalents(snap(positioned(cells)));
    expect(out.layout).toBe('grid');
    expect(out.nodes).toHaveLength(84);
    out.nodes.forEach((n, i) => {
      expect({ tree: n.tree, col: n.col, row: n.row }).toEqual(cells[i]);
    });
    expect(out.trees).toEqual([
      { index: 0, spent: 28 },
      { index: 1, spent: 56 },
      { index: 2, spent: 84 },
    ]);
  });

  it('emits format/source/syncedAt/configId/importString and drops raw positions', () => {
    const out = snapshotToForeverTalents(snap(positioned(allCells())));
    expect(out).toMatchObject({
      format: 'forever',
      source: 'addon',
      syncedAt: CAPTURED_AT,
      configId: 7,
      importString: 'abc',
    });
    expect(Object.keys(out.nodes[0]!).sort()).toEqual(
      ['col', 'maxRanks', 'nodeId', 'rank', 'row', 'tree'].sort(),
    );
  });

  it('tolerates inexact posX (Paladin: 5020 + 5030 in one column, 13 distinct X, 50 nodes)', () => {
    const cells = allCells().filter(
      (c) => c.col === 0 || c.row <= 2 || (c.tree === 0 && c.row === 3 && c.col <= 2),
    );
    expect(cells).toHaveLength(50);
    const nodes = cells.map((c, i) => ({
      nodeId: 1 + i,
      rank: 1,
      ...pos(c, c.tree === 1 && c.col === 0 && c.row % 2 === 1 ? 10 : 0),
    }));
    expect(new Set(nodes.map((n) => n.posX)).size).toBe(13);
    const out = snapshotToForeverTalents(snap(nodes));
    expect(out.layout).toBe('grid');
    out.nodes.forEach((n, i) => {
      expect({ tree: n.tree, col: n.col, row: n.row }).toEqual(cells[i]);
    });
  });

  it('does not split a sparse sub-tree (only cols 0 and 3 → internal gap 1800)', () => {
    const cells = allCells().filter((c) => c.tree !== 0 || c.col === 0 || c.col === 3);
    const out = snapshotToForeverTalents(snap(positioned(cells)));
    expect(out.layout).toBe('grid');
    expect(out.trees.map((t) => t.index)).toEqual([0, 1, 2]);
    const sparse = out.nodes.filter((n) => n.tree === 0);
    expect(new Set(sparse.map((n) => n.col))).toEqual(new Set([0, 3]));
    out.nodes.forEach((n, i) => {
      expect({ tree: n.tree, col: n.col, row: n.row }).toEqual(cells[i]);
    });
  });
});

describe('snapshotToForeverTalents — addon hints (D5)', () => {
  it('uses addon tree/row/col verbatim when every node carries them', () => {
    const nodes = positioned(allCells().slice(0, 3)).map((n, i) => ({
      ...n,
      tree: 2,
      row: 5,
      col: i,
    }));
    const out = snapshotToForeverTalents(snap(nodes));
    expect(out.layout).toBe('grid');
    expect(out.nodes.map((n) => [n.tree, n.row, n.col])).toEqual([
      [2, 5, 0],
      [2, 5, 1],
      [2, 5, 2],
    ]);
    expect(out.trees).toEqual([
      { index: 0, spent: 0 },
      { index: 1, spent: 0 },
      { index: 2, spent: 3 },
    ]);
  });

  it('derives from positions when only some nodes carry hints', () => {
    const cells = allCells();
    const nodes = positioned(cells).map((n, i) =>
      i < 5 ? { ...n, tree: 2, row: 9, col: 3 } : n,
    );
    const out = snapshotToForeverTalents(snap(nodes));
    expect(out.layout).toBe('grid');
    out.nodes.forEach((n, i) => {
      expect({ tree: n.tree, col: n.col, row: n.row }).toEqual(cells[i]);
    });
  });
});

describe('snapshotToForeverTalents — list fallback', () => {
  function expectList(nodes: ForeverTalentNodeInput[]): void {
    const out = snapshotToForeverTalents(snap(nodes));
    expect(out.layout).toBe('list');
    expect(out.trees).toEqual([]);
    out.nodes.forEach((n) => {
      expect(n.tree).toBeUndefined();
      expect(n.row).toBeUndefined();
      expect(n.col).toBeUndefined();
    });
  }

  it('mixed positions (some nodes without posX/posY) → list (R-A)', () => {
    const nodes = positioned(allCells());
    nodes.push({ nodeId: 5555, rank: 1 });
    expectList(nodes);
  });

  it('ranked-only nodes without positions (v1.1.2) → list, carrying rank/maxRanks/name', () => {
    const nodes = [
      { nodeId: 1, rank: 3, maxRanks: 5, name: 'Deflection', spellId: 16466 },
      { nodeId: 2, rank: 1, maxRanks: 1, name: 'Mortal Strike' },
    ];
    expectList(nodes);
    expect(snapshotToForeverTalents(snap(nodes)).nodes).toEqual(nodes);
  });

  it('two nodes colliding on (tree,row,col) → list', () => {
    const nodes = positioned(allCells());
    nodes.push({ nodeId: 4444, rank: 1, posX: 1020, posY: 2130 });
    expectList(nodes);
  });

  it('four posX clusters → list', () => {
    const nodes = positioned(allCells());
    nodes.push({ nodeId: 4444, rank: 1, posX: 13080, posY: 2130 });
    expectList(nodes);
  });

  it('a row beyond 9 → list', () => {
    const nodes = positioned(allCells());
    nodes.push({ nodeId: 4444, rank: 1, posX: 1020, posY: 2130 + 600 * 10 });
    expectList(nodes);
  });

  it('a col beyond 3 inside one cluster → list', () => {
    const nodes = positioned(allCells());
    nodes.push({ nodeId: 4444, rank: 1, posX: 1020 + 600 * 4, posY: 2130 });
    expectList(nodes);
  });

  it('schema-1 nodes ({nodeId, rank} only) → list', () => {
    const nodes = [
      { nodeId: 1, rank: 2 },
      { nodeId: 2, rank: 0 },
    ];
    expectList(nodes);
    expect(snapshotToForeverTalents(snap(nodes)).nodes).toEqual(nodes);
  });

  it('omits configId/importString when the snapshot has none', () => {
    const out = snapshotToForeverTalents({ capturedAt: CAPTURED_AT, nodes: [] });
    expect(out).toEqual({
      format: 'forever',
      source: 'addon',
      syncedAt: CAPTURED_AT,
      layout: 'list',
      trees: [],
      nodes: [],
    });
  });
});
