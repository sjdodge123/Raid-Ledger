/**
 * ROK-2113 T1: Blizzard returns only the talent trees a character has spent
 * points in, in its own order, and both converters (api
 * `forever-blizzard-talents.adapter.ts`, web `forever-classic-fallback.ts`)
 * number them by array position. A Warrior with only "Protection" so arrived
 * as tree 0 and rendered in the Arms column, with a second "Protection" header
 * filled in from the class table. This moves each Blizzard tree (and its
 * nodes) to its class column BY NAME. Pure.
 *
 * If any named tree is unknown to the class table, or two names claim one
 * column, the payload is returned unchanged (today's positional behaviour).
 */
import type { ForeverTalentsDto } from '@raid-ledger/contract';
import { foreverClassTreeIndex } from './forever-talent-trees';

type Trees = ForeverTalentsDto['trees'];

/** Named trees → their class column; undefined when a name is unknown or a column is claimed twice. */
function namedColumns(trees: Trees, characterClass: string | null | undefined): Map<number, number> | undefined {
    const columns = new Map<number, number>();
    for (const tree of trees) {
        if (tree.name === undefined) continue;
        const column = foreverClassTreeIndex(characterClass, tree.name);
        if (column === undefined || [...columns.values()].includes(column) || columns.has(tree.index)) return undefined;
        columns.set(tree.index, column);
    }
    return columns;
}

function isFreeColumn(columns: Map<number, number>, column: number): boolean {
    return column >= 0 && column <= 2 && ![...columns.values()].includes(column);
}

/**
 * Blizzard tree index → class column: named trees by name; an unnamed tree
 * keeps its own column when free, else takes the first free one.
 */
function columnMap(trees: Trees, characterClass: string | null | undefined): Map<number, number> | undefined {
    const columns = namedColumns(trees, characterClass);
    if (!columns) return undefined;
    const unnamed = trees.filter((t) => !columns.has(t.index));
    for (const tree of unnamed) if (isFreeColumn(columns, tree.index)) columns.set(tree.index, tree.index);
    for (const tree of unnamed) {
        if (columns.has(tree.index)) continue;
        const column = [0, 1, 2].find((c) => isFreeColumn(columns, c));
        if (column === undefined) return undefined;
        columns.set(tree.index, column);
    }
    return columns;
}

/**
 * A Blizzard payload with each tree and node moved to its class column by
 * tree name; `talents` itself when nothing moves, it is not Blizzard-sourced,
 * or a tree name is unknown.
 */
export function alignArmoryTrees(talents: ForeverTalentsDto, characterClass: string | null | undefined): ForeverTalentsDto {
    if (talents.source !== 'blizzard') return talents;
    const columns = columnMap(talents.trees, characterClass);
    if (!columns || [...columns].every(([from, to]) => from === to)) return talents;
    const trees = talents.trees.map((t) => ({ ...t, index: columns.get(t.index) ?? t.index })).sort((a, b) => a.index - b.index);
    const nodes = talents.nodes.map((n) => {
        const tree = n.tree === undefined ? undefined : columns.get(n.tree);
        return tree === undefined ? n : { ...n, tree };
    });
    return { ...talents, trees, nodes };
}
