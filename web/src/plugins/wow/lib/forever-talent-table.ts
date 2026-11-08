/**
 * ROK-2146: the static WoW: Forever talent table (`talent-data/forever-trees.json`,
 * extracted from Wowhead's Forever calculator) and the join of a character's spent
 * ranks onto it. Replaces the TBC-sourced `CLASSIC_TALENT_POSITIONS` for Forever.
 *
 * The JSON is lazy-loaded through `import.meta.glob`, so it never lands in the
 * entry chunk, and a checkout without the file still builds: the loader resolves
 * `null` and the display keeps its old grid/pills.
 */
import type { ForeverTalentNodeDto, ForeverTalentsDto } from '@raid-ledger/contract';
import { ownLookup } from '../../../lib/own-lookup';

export interface ForeverTableTalent {
    spellId: number;
    name: string;
    row: number;
    col: number;
    maxRank: number;
    icon: string;
    prereqSpellId: number | null;
}
export interface ForeverTableTree { name: string; talents: ForeverTableTalent[] }
export interface ForeverClassTable { trees: ForeverTableTree[] }
export type ForeverTalentTable = Record<string, ForeverClassTable>;

export interface JoinedTalent extends ForeverTableTalent { rank: number }
export interface JoinedTree { name: string; index: number; spent: number; talents: JoinedTalent[] }
/** Every table talent with its rank, plus the ranked nodes nothing matched (ROK-2113 "Other talents"). */
export interface JoinedForeverTalents { trees: JoinedTree[]; other: ForeverTalentNodeDto[] }

// Glob, not a literal import(): resolves to {} when the file is absent instead of failing the build.
const TABLE_LOADERS = import.meta.glob<unknown>('./talent-data/forever-trees.json', { import: 'default' });

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTalent(value: unknown): value is ForeverTableTalent {
    if (!isRecord(value)) return false;
    const nums = ['spellId', 'row', 'col', 'maxRank'].every((k) => typeof value[k] === 'number');
    const prereq = value.prereqSpellId === null || typeof value.prereqSpellId === 'number';
    return nums && prereq && typeof value.name === 'string' && typeof value.icon === 'string';
}

function isClassTable(value: unknown): value is ForeverClassTable {
    if (!isRecord(value) || !Array.isArray(value.trees)) return false;
    return value.trees.every((t: unknown) => isRecord(t) && typeof t.name === 'string' && Array.isArray(t.talents) && t.talents.every(isTalent));
}

/** Shape guard for the JSON (it is data, not code — a bad extract must not crash the page). */
export function isForeverTalentTable(value: unknown): value is ForeverTalentTable {
    return isRecord(value) && Object.values(value).every(isClassTable);
}

let tablePromise: Promise<ForeverTalentTable | null> | undefined;

function loadTable(): Promise<ForeverTalentTable | null> {
    const load = Object.values(TABLE_LOADERS)[0];
    if (!load) return Promise.resolve(null);
    tablePromise ??= load().then((json) => (isForeverTalentTable(json) ? json : null), () => null);
    return tablePromise;
}

/** "Warrior" → "warrior"; the table's class slugs are lower-case single words. */
function classSlug(characterClass: string): string {
    return characterClass.trim().toLowerCase().replace(/\s+/g, '');
}

/** The class's trees, or null when the table (or the class in it) is missing. */
export async function loadForeverClassTable(characterClass: string | null | undefined): Promise<ForeverClassTable | null> {
    if (!characterClass) return null;
    const table = await loadTable();
    return (table && ownLookup(table, classSlug(characterClass))) ?? null;
}

/** "Improved  Bloodrage" / "improved-bloodrage" → "improved bloodrage". */
export function normaliseTalentName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

type Matches = Map<ForeverTableTalent, ForeverTalentNodeDto>;

/** Pass 1: spellId anywhere in the class. Pass 2: normalised name within the talent's tree. */
function matchNodes(nodes: ForeverTalentNodeDto[], table: ForeverClassTable): Matches {
    const matches: Matches = new Map();
    const used = new Set<ForeverTalentNodeDto>();
    const claim = (talent: ForeverTableTalent, node: ForeverTalentNodeDto | undefined) => {
        if (!node) return;
        matches.set(talent, node);
        used.add(node);
    };
    const all = table.trees.flatMap((tree, index) => tree.talents.map((talent) => ({ talent, index })));
    for (const { talent } of all) claim(talent, nodes.find((n) => !used.has(n) && n.spellId === talent.spellId));
    for (const { talent, index } of all) {
        if (matches.has(talent)) continue;
        const key = normaliseTalentName(talent.name);
        claim(talent, nodes.find((n) => !used.has(n) && n.name !== undefined && n.tree === index && normaliseTalentName(n.name) === key));
    }
    return matches;
}

/**
 * Spent ranks joined onto the class table (ROK-2146 "Joining spent ranks"). Tree points
 * come from the DTO's `trees[].spent` when present (the Blizzard converter keeps ranks
 * it drops from `nodes`), else the sum of the matched ranks. Pass an aligned DTO.
 */
export function joinForeverTalents(talents: ForeverTalentsDto, table: ForeverClassTable): JoinedForeverTalents {
    const matches = matchNodes(talents.nodes, table);
    const matched = new Set(matches.values());
    const trees = table.trees.map((tree, index) => {
        const joined = tree.talents.map((t) => ({ ...t, rank: matches.get(t)?.rank ?? 0 }));
        const summed = joined.reduce((sum, t) => sum + t.rank, 0);
        const spent = talents.trees.find((t) => t.index === index)?.spent ?? summed;
        return { name: tree.name, index, spent, talents: joined };
    });
    return { trees, other: talents.nodes.filter((n) => n.rank > 0 && !matched.has(n)) };
}

/** The tree a phone opens on: most points, the first on a tie or with none spent (ruling 4). */
export function mostPointsTreeIndex(trees: readonly { spent: number }[]): number {
    return trees.reduce((best, tree, i) => (tree.spent > (trees[best]?.spent ?? 0) ? i : best), 0);
}
