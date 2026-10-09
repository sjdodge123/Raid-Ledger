/**
 * Pure adapter: LedgerLink talent snapshot → `ForeverTalentsDto` (ROK-1744).
 * No DB / Nest. Grid rule shared with the addon (LedgerLink TalentGrid.lua, PR #25).
 */
import {
  ForeverTalentsSchema,
  type ForeverTalentNodeDto,
  type ForeverTalentsDto,
} from '@raid-ledger/contract';

/** A sorted-posX gap strictly greater than this starts a new sub-tree. */
export const TALENT_TREE_GAP = 2000;
/** Horizontal distance between adjacent columns inside a sub-tree. */
export const TALENT_COL_STEP = 600;
/** posY of row 0. */
export const TALENT_ROW_ORIGIN = 2130;
/** Vertical distance between adjacent rows. */
export const TALENT_ROW_STEP = 600;
const TREE_COUNT = 3;
const MAX_COL = 3;
const MAX_ROW = 9;

/** One snapshot node as the adapter consumes it (1742's schema maps onto this). */
export interface ForeverTalentNodeInput {
  nodeId: number;
  rank: number;
  maxRanks?: number;
  name?: string;
  spellId?: number;
  posX?: number;
  posY?: number;
  tree?: number;
  row?: number;
  col?: number;
  entryId?: number;
}

/** Talent snapshot input (capturedAt becomes the DTO's syncedAt). */
export interface ForeverTalentSnapshotInput {
  capturedAt: string;
  configId?: number;
  importString?: string;
  nodes: ForeverTalentNodeInput[];
}

interface Slot {
  tree: number;
  row: number;
  col: number;
}

/** Copy the display fields of a node, dropping entryId/posX/posY and hints. */
function copyNode(n: ForeverTalentNodeInput): ForeverTalentNodeDto {
  const out: ForeverTalentNodeDto = { nodeId: n.nodeId, rank: n.rank };
  if (n.maxRanks !== undefined) out.maxRanks = n.maxRanks;
  if (n.name !== undefined) out.name = n.name;
  if (n.spellId !== undefined) out.spellId = n.spellId;
  return out;
}

/** Smallest posX of each sub-tree cluster, left → right. */
function clusterOrigins(xs: number[]): number[] {
  const sorted = [...new Set(xs)].sort((a, b) => a - b);
  return sorted.filter(
    (x, i) => i === 0 || x - sorted[i - 1]! > TALENT_TREE_GAP,
  );
}

/** Derive slots from raw posX/posY (caller guarantees every node has both). */
function deriveSlots(nodes: ForeverTalentNodeInput[]): Slot[] | null {
  const origins = clusterOrigins(nodes.map((n) => n.posX!));
  if (origins.length !== TREE_COUNT) return null;
  return nodes.map((n) => {
    const tree = origins.filter((o) => o <= n.posX!).length - 1;
    return {
      tree,
      col: Math.round((n.posX! - origins[tree]!) / TALENT_COL_STEP),
      row: Math.round((n.posY! - TALENT_ROW_ORIGIN) / TALENT_ROW_STEP),
    };
  });
}

/** D5 source order: addon hints on every node → positions on every node → none. */
function pickSlots(nodes: ForeverTalentNodeInput[]): Slot[] | null {
  if (nodes.length === 0) return null;
  const hinted = nodes.every(
    (n) => n.tree !== undefined && n.row !== undefined && n.col !== undefined,
  );
  if (hinted)
    return nodes.map((n) => ({ tree: n.tree!, row: n.row!, col: n.col! }));
  if (nodes.every((n) => n.posX !== undefined && n.posY !== undefined))
    return deriveSlots(nodes);
  return null;
}

/** In-range integers with no two nodes on the same (tree,row,col). */
function slotsValid(slots: Slot[]): boolean {
  const inRange = (v: number, max: number): boolean =>
    Number.isInteger(v) && v >= 0 && v <= max;
  const ok = slots.every(
    (s) =>
      inRange(s.tree, TREE_COUNT - 1) &&
      inRange(s.row, MAX_ROW) &&
      inRange(s.col, MAX_COL),
  );
  return (
    ok &&
    new Set(slots.map((s) => `${s.tree}:${s.row}:${s.col}`)).size ===
      slots.length
  );
}

/** `spent = Σ rank` for each of the three sub-trees. */
function treeSpend(nodes: ForeverTalentNodeDto[]): ForeverTalentsDto['trees'] {
  return [0, 1, 2].map((index) => ({
    index,
    spent: nodes
      .filter((n) => n.tree === index)
      .reduce((sum, n) => sum + n.rank, 0),
  }));
}

/** Map a talent snapshot onto the `format:'forever'` DTO; grid when resolvable, else list. */
export function snapshotToForeverTalents(
  snapshot: ForeverTalentSnapshotInput,
): ForeverTalentsDto {
  const picked = pickSlots(snapshot.nodes);
  const slots = picked && slotsValid(picked) ? picked : null;
  const nodes = snapshot.nodes.map((n, i) => ({
    ...copyNode(n),
    ...(slots ? slots[i] : {}),
  }));
  const trees = slots ? treeSpend(nodes) : [];
  const dto: ForeverTalentsDto = {
    format: 'forever',
    source: 'addon',
    syncedAt: snapshot.capturedAt,
    layout: slots ? 'grid' : 'list',
    trees,
    nodes,
  };
  if (snapshot.configId !== undefined) dto.configId = snapshot.configId;
  if (snapshot.importString !== undefined)
    dto.importString = snapshot.importString;
  return ForeverTalentsSchema.parse(dto);
}
