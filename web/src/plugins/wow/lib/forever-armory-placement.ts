/**
 * ROK-2110 (D5, F1, F3): place Blizzard-sourced WoW: Forever talents that
 * arrive without grid positions (`layout: 'list'`) onto the known trees
 * (`CLASSIC_TALENT_POSITIONS`, keyed by talent-name slug). Every ranked node
 * placed → a `grid` DTO; any ranked node unknown → the DTO unchanged, so the
 * existing list rendering ("unplaced" fallback) applies. Pure.
 *
 * The known-trees table is TBC-sourced (Wowhead TBC Classic calculator, rows
 * a–i) while vanilla — and so Forever — trees have 7 tiers (rows 0–6). So a
 * position past row 6, or two ranked talents landing in one cell, rejects the
 * WHOLE payload back to the list: a wrong cell is worse than no grid. A
 * same-named talent whose vanilla cell differs from its TBC one can still
 * slip through; a vanilla position table is tracked in TECH-DEBT-BACKLOG.md.
 */
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { ownLookup } from '../../../lib/own-lookup';
import { CLASSIC_TALENT_POSITIONS, nameToSlug } from './classic-talent-positions';
import { foreverTreeNames } from './forever-talent-trees';
import type { ClassPositionMap } from './talent-data/types';

const ROW_LETTERS = 'abcdefghi';
/** Vanilla/Forever trees have 7 tiers (rows 0–6); TBC rows h/i never place. */
const MAX_ROW = 6;

/** Header names whose known-tree key differs (`foreverTreeNames` says "Feral"). */
const TREE_KEY_ALIASES: Readonly<Record<string, string>> = { Feral: 'Feral Combat' };

/** Tree header names: Blizzard's `trees[].name` first, then the class table (F3). */
export function armoryTreeNames(talents: ForeverTalentsDto, characterClass: string | null | undefined): string[] {
    const fallback = foreverTreeNames(characterClass);
    return [0, 1, 2].map((i) => talents.trees.find((t) => t.index === i)?.name ?? fallback[i] ?? `Tree ${i + 1}`);
}

function classPositions(characterClass: string | null | undefined): ClassPositionMap | undefined {
    const raw = characterClass?.trim().toLowerCase() ?? '';
    const title = raw.charAt(0).toUpperCase() + raw.slice(1);
    return ownLookup(CLASSIC_TALENT_POSITIONS, title);
}

/** "c2" → { row: 2, col: 1 }; undefined when malformed or past row 6. */
function parsePosition(pos: string): { row: number; col: number } | undefined {
    const row = ROW_LETTERS.indexOf(pos.charAt(0));
    const col = Number(pos.slice(1)) - 1;
    return row >= 0 && row <= MAX_ROW && Number.isInteger(col) && col >= 0 && col <= 3 ? { row, col } : undefined;
}

function placeNode(node: ForeverTalentNodeDto, map: ClassPositionMap, treeNames: string[]): ForeverTalentNodeDto | undefined {
    if (node.tree === undefined || !node.name) return undefined;
    const header = treeNames[node.tree] ?? '';
    const tree = ownLookup(map, header) ?? ownLookup(map, ownLookup(TREE_KEY_ALIASES, header) ?? '');
    const pos = tree ? ownLookup(tree, nameToSlug(node.name)) : undefined;
    const rc = pos ? parsePosition(pos) : undefined;
    return rc ? { ...node, ...rc } : undefined;
}

/** Every ranked node placed on a distinct cell, or undefined (no partial grids). */
function placeAll(ranked: ForeverTalentNodeDto[], map: ClassPositionMap, treeNames: string[]): ForeverTalentNodeDto[] | undefined {
    const taken = new Set<string>();
    const nodes: ForeverTalentNodeDto[] = [];
    for (const node of ranked) {
        const placed = placeNode(node, map, treeNames);
        const cell = placed ? `${String(placed.tree)}:${String(placed.row)}:${String(placed.col)}` : undefined;
        if (!placed || !cell || taken.has(cell)) return undefined;
        taken.add(cell);
        nodes.push(placed);
    }
    return nodes;
}

/** A grid DTO when every ranked node lands on its own cell of the known trees; else `talents` unchanged. */
export function placeArmoryTalents(talents: ForeverTalentsDto, characterClass: string | null | undefined): ForeverTalentsDto {
    if (talents.source !== 'blizzard' || talents.layout !== 'list') return talents;
    const map = classPositions(characterClass);
    const ranked = talents.nodes.filter((n) => n.rank > 0);
    if (!map || ranked.length === 0) return talents;
    const treeNames = armoryTreeNames(talents, characterClass);
    const nodes = placeAll(ranked, map, treeNames);
    return nodes ? { ...talents, layout: 'grid', nodes } : talents;
}
