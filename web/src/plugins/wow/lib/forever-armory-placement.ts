/**
 * ROK-2110 (D5, F1, F3) + ROK-2113: place Blizzard-sourced WoW: Forever
 * talents that arrive without grid positions (`layout: 'list'`) onto the known
 * trees (`CLASSIC_TALENT_POSITIONS`, keyed by talent-name slug). Pure.
 *
 * Per-talent fallback (ROK-2113, operator ruling 2026-11-07): every ranked
 * node the table can place gets its cell; the rest stay in the DTO with their
 * `tree` but no `row`/`col`, and the grid lists them as "Other talents" under
 * their tree. Only when NO ranked node places does the DTO stay a list.
 *
 * The known-trees table is TBC-sourced (Wowhead TBC Classic calculator, rows
 * a–i) while vanilla — and so Forever — trees have 7 tiers (rows 0–6). So a
 * position past row 6 is unplaced, and two ranked talents landing in one cell
 * are BOTH unplaced: a wrong cell is worse than a listed talent. A same-named
 * talent whose vanilla cell differs from its TBC one can still slip through;
 * a vanilla position table is tracked in TECH-DEBT-BACKLOG.md.
 */
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { ownLookup } from '../../../lib/own-lookup';
import { CLASSIC_TALENT_POSITIONS, nameToSlug } from './classic-talent-positions';
import { alignArmoryTrees } from './forever-armory-tree-align';
import { foreverTreeNames } from './forever-talent-trees';
import type { ClassPositionMap } from './talent-data/types';

const ROW_LETTERS = 'abcdefghi';
/** Vanilla/Forever trees have 7 tiers (rows 0–6); TBC rows h/i never place. */
const MAX_ROW = 6;

/** Header names whose known-tree key differs (`foreverTreeNames` says "Feral"). */
const TREE_KEY_ALIASES: Readonly<Record<string, string>> = { Feral: 'Feral Combat' };

/**
 * Tree header names: Blizzard's `trees[].name` first, then the class table
 * (F3) — after moving each Blizzard tree to its class column by name (T1).
 */
export function armoryTreeNames(talents: ForeverTalentsDto, characterClass: string | null | undefined): string[] {
    const fallback = foreverTreeNames(characterClass);
    const { trees } = alignArmoryTrees(talents, characterClass);
    return [0, 1, 2].map((i) => trees.find((t) => t.index === i)?.name ?? fallback[i] ?? `Tree ${i + 1}`);
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

function cellKey(node: ForeverTalentNodeDto): string {
    return `${String(node.tree)}:${String(node.row)}:${String(node.col)}`;
}

/** The node with any `row`/`col` removed — listed under its tree, never on a cell. */
function unpositioned(node: ForeverTalentNodeDto): ForeverTalentNodeDto {
    const copy = { ...node };
    delete copy.row;
    delete copy.col;
    return copy;
}

/** Each ranked node on its own known cell, or unpositioned (unknown, past row 6, or a shared cell). */
function placeEach(ranked: ForeverTalentNodeDto[], map: ClassPositionMap, treeNames: string[]): ForeverTalentNodeDto[] {
    const placed = ranked.map((node) => placeNode(node, map, treeNames));
    const counts = new Map<string, number>();
    for (const p of placed) if (p) counts.set(cellKey(p), (counts.get(cellKey(p)) ?? 0) + 1);
    return ranked.map((node, i) => {
        const p = placed[i];
        return p && counts.get(cellKey(p)) === 1 ? p : unpositioned(node);
    });
}

function hasCell(node: ForeverTalentNodeDto): boolean {
    return node.row !== undefined && node.col !== undefined;
}

/**
 * Each Blizzard tree moved to its class column by name (ROK-2113 T1), then a
 * grid DTO when at least one ranked node lands on its own cell of the known
 * trees (the others unpositioned, ROK-2113); else the aligned list.
 */
export function placeArmoryTalents(talents: ForeverTalentsDto, characterClass: string | null | undefined): ForeverTalentsDto {
    if (talents.source !== 'blizzard' || talents.layout !== 'list') return talents;
    const aligned = alignArmoryTrees(talents, characterClass);
    const map = classPositions(characterClass);
    const ranked = aligned.nodes.filter((n) => n.rank > 0);
    if (!map || ranked.length === 0) return aligned;
    const nodes = placeEach(ranked, map, armoryTreeNames(aligned, characterClass));
    return nodes.some(hasCell) ? { ...aligned, layout: 'grid', nodes } : aligned;
}
