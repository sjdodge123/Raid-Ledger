/**
 * ROK-2110: read-time converter from the stored Blizzard `specializations`
 * talents (Classic shape written by `buildClassicTalentData`:
 * `{ format: 'classic', trees: [{ name, spentPoints, talents: [{ name, id,
 * spellId, rank, tierIndex, columnIndex }] }] }`) into the Forever display
 * DTO (`format: 'forever', source: 'blizzard'`). Pure; stored data untouched.
 *
 * Rulings: missing rank → 0 (F8); no maxRanks (F9); nodeId = talent id, else
 * spellId. A talent with neither identifier is DROPPED from `nodes` but its
 * rank is still counted in `trees[].spent`, so `trees[].spent` is the
 * authoritative points total — consumers must not re-sum `nodes` for it.
 */
import {
  ForeverTalentsSchema,
  type ForeverTalentNodeDto,
  type ForeverTalentsDto,
} from '@raid-ledger/contract';

/** Vanilla tier/column bounds (D5): rows 0-6, columns 0-3. */
const MAX_ROW = 6;
const MAX_COL = 3;
const MAX_TREES = 3;
const MAX_NAME = 64;

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const posInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;

const intIn = (v: unknown, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max
    ? v
    : undefined;

/** F8: a missing / non-numeric rank is 0. */
function rankOf(t: Rec): number {
  const r = t.rank;
  return typeof r === 'number' && Number.isInteger(r) && r > 0 ? r : 0;
}

function nameOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0
    ? v.slice(0, MAX_NAME)
    : undefined;
}

/** One stored talent as a node in tree `tree`, or null without an id. */
export function toBlizzardNode(
  t: Rec,
  tree: number,
): ForeverTalentNodeDto | null {
  const nodeId = posInt(t.id) ?? posInt(t.spellId);
  if (nodeId === undefined) return null;
  const name = nameOf(t.name);
  const spellId = posInt(t.spellId);
  const row = intIn(t.tierIndex, MAX_ROW);
  const col = intIn(t.columnIndex, MAX_COL);
  return {
    nodeId,
    rank: rankOf(t),
    tree,
    ...(name !== undefined ? { name } : {}),
    ...(spellId !== undefined ? { spellId } : {}),
    ...(row !== undefined && col !== undefined ? { row, col } : {}),
  };
}

const talentsOf = (tree: Rec): Rec[] =>
  Array.isArray(tree.talents) ? tree.talents.filter(isRec) : [];

/** Tree summary: index, Σrank over every talent (dropped ones too), name. */
export function treeSummary(
  tree: Rec,
  index: number,
): ForeverTalentsDto['trees'][number] {
  const spent = talentsOf(tree).reduce((sum, t) => sum + rankOf(t), 0);
  const name = nameOf(tree.name);
  return { index, spent, ...(name !== undefined ? { name } : {}) };
}

/** grid ⇔ at least one node and every node carries row + col. */
function layoutOf(nodes: ForeverTalentNodeDto[]): 'grid' | 'list' {
  const placed = nodes.every((n) => n.row !== undefined && n.col !== undefined);
  return nodes.length > 0 && placed ? 'grid' : 'list';
}

function isoOrNull(lastSyncedAt: string | null): string | null {
  if (!lastSyncedAt) return null;
  const ms = Date.parse(lastSyncedAt);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The stored Classic trees (≤3), or null when `stored` is not that shape. */
function classicTrees(stored: unknown): Rec[] | null {
  if (!isRec(stored) || stored.format !== 'classic') return null;
  if (!Array.isArray(stored.trees)) return null;
  const trees = stored.trees.filter(isRec).slice(0, MAX_TREES);
  return trees.length > 0 ? trees : null;
}

/**
 * Convert stored Blizzard talents into the Forever display DTO.
 * @returns undefined unless `stored` is `format: 'classic'` with ≥1 tree and
 *   `lastSyncedAt` parses (it becomes `syncedAt`).
 */
export function blizzardToForeverTalents(
  stored: unknown,
  lastSyncedAt: string | null,
): ForeverTalentsDto | undefined {
  const trees = classicTrees(stored);
  const syncedAt = isoOrNull(lastSyncedAt);
  if (!trees || !syncedAt) return undefined;
  const nodes = trees.flatMap((tree, i) =>
    talentsOf(tree).flatMap((t) => toBlizzardNode(t, i) ?? []),
  );
  const parsed = ForeverTalentsSchema.safeParse({
    format: 'forever',
    source: 'blizzard',
    syncedAt,
    layout: layoutOf(nodes),
    trees: trees.map(treeSummary),
    nodes: nodes.slice(0, 200),
  });
  return parsed.success ? parsed.data : undefined;
}
