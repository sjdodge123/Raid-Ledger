/**
 * ROK-2146: the static WoW: Forever talent table (one `talent-data/forever/<class>.json`
 * per class, extracted from Wowhead's Forever calculator) and the join of a character's
 * spent ranks onto it. Replaces the TBC-sourced `CLASSIC_TALENT_POSITIONS` for Forever.
 *
 * Each class file is lazy-loaded through `import.meta.glob`, so only the viewed class's
 * chunk is fetched (ROK-2150: the per-rank text made one all-class chunk 32 KB gz), it
 * never lands in the entry chunk, and a checkout without the files still builds: the
 * loader resolves `null` and the display keeps its old grid/pills.
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
    /** ROK-2150: per-rank tooltip text, plain text with `\n` breaks (index 0 = rank 1, length = maxRank). */
    descriptions: string[];
}
export interface ForeverTableTree { name: string; talents: ForeverTableTalent[] }
/** `hashVersion`: the Wowhead calculator build-string version the table was extracted with (ROK-2150). */
export interface ForeverClassTable { hashVersion: string; trees: ForeverTableTree[] }
export type ForeverTalentTable = Record<string, ForeverClassTable>;

export interface JoinedTalent extends ForeverTableTalent { rank: number }
export interface JoinedTree { name: string; index: number; spent: number; talents: JoinedTalent[] }
/** Every table talent with its rank, plus the ranked nodes nothing matched (ROK-2113 "Other talents"). */
export interface JoinedForeverTalents { trees: JoinedTree[]; other: ForeverTalentNodeDto[] }

// Glob, not a literal import(): resolves to {} when the files are absent instead of failing the build.
const CLASS_LOADERS = import.meta.glob<unknown>('./talent-data/forever/*.json', { import: 'default' });

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTalent(value: unknown): value is ForeverTableTalent {
    if (!isRecord(value)) return false;
    const nums = ['spellId', 'row', 'col', 'maxRank'].every((k) => typeof value[k] === 'number');
    const prereq = value.prereqSpellId === null || typeof value.prereqSpellId === 'number';
    return nums && prereq && typeof value.name === 'string' && typeof value.icon === 'string' && hasRankDescriptions(value);
}

/** One plain-text description per rank — a short or HTML-bearing list is a bad extract. */
function hasRankDescriptions(value: Record<string, unknown>): boolean {
    const { descriptions, maxRank } = value;
    return Array.isArray(descriptions) && descriptions.length === maxRank
        && descriptions.every((d: unknown) => typeof d === 'string' && d.length > 0 && !/[<>]/.test(d));
}

/** One class file's shape: `{ hashVersion, trees }`. */
export function isForeverClassTable(value: unknown): value is ForeverClassTable {
    if (!isRecord(value) || !Array.isArray(value.trees)) return false;
    if (typeof value.hashVersion !== 'string' || value.hashVersion.length === 0) return false;
    return value.trees.every((t: unknown) => isRecord(t) && typeof t.name === 'string' && Array.isArray(t.talents) && t.talents.every(isTalent));
}

/** Shape guard for the JSON (it is data, not code — a bad extract must not crash the page). */
export function isForeverTalentTable(value: unknown): value is ForeverTalentTable {
    return isRecord(value) && Object.values(value).every(isForeverClassTable);
}

/** "Warrior" → "warrior"; the class file names are lower-case single words. */
function classSlug(characterClass: string): string {
    return characterClass.trim().toLowerCase().replace(/\s+/g, '');
}

/** The lazy loader of `./talent-data/forever/<slug>.json`, or undefined when there is no such file. */
function classLoader(slug: string): (() => Promise<unknown>) | undefined {
    return ownLookup(CLASS_LOADERS, `./talent-data/forever/${slug}.json`);
}

const classPromises = new Map<string, Promise<ForeverClassTable | null>>();
/** Per class slug: the settled table (null = malformed); absent until its first load settles. */
const settledClasses = new Map<string, ForeverClassTable | null>();

function loadClass(slug: string): Promise<ForeverClassTable | null> {
    const load = classLoader(slug);
    if (!load) return Promise.resolve(null);
    let promise = classPromises.get(slug);
    if (!promise) {
        promise = load().then((json) => (isForeverClassTable(json) ? json : null), () => null)
            .then((table) => { settledClasses.set(slug, table); return table; });
        classPromises.set(slug, promise);
    }
    return promise;
}

/** The class's trees, or null when the class has no (or a malformed) table file. */
export async function loadForeverClassTable(characterClass: string | null | undefined): Promise<ForeverClassTable | null> {
    if (!characterClass) return null;
    return loadClass(classSlug(characterClass));
}

/**
 * The class's trees without waiting: undefined until that class's file has settled once
 * (the caller then loads it), else the trees or null — so a revisit draws with no placeholder.
 */
export function peekForeverClassTable(characterClass: string | null | undefined): ForeverClassTable | null | undefined {
    if (!characterClass) return null;
    const slug = classSlug(characterClass);
    if (!classLoader(slug)) return null;
    return settledClasses.has(slug) ? (settledClasses.get(slug) ?? null) : undefined;
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
