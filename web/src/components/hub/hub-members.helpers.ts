/**
 * ROK-1830 S3b — the pure parts of the core Members list: the search filter,
 * the banding a grouping column asks for, and the count line. Core knows
 * nothing about what a row means; the hub module supplies the rows, the
 * searchable text and the grouping function.
 */
import type { HubMemberColumn, HubMemberRow, HubMemberSort } from '../../plugins/hub-module';

/** One band of the list: a whole ungrouped list, or one group's rows. */
export interface HubMemberBand {
    key: string;
    /** Empty while the list is ungrouped — core then draws no band heading. */
    label: string;
    testId: string;
    rows: readonly HubMemberRow[];
}

/** The column whose `groupBy` drives the "Group by …" toggle, if a module declares one. */
export function groupingColumn(columns: readonly HubMemberColumn[]): HubMemberColumn | undefined {
    return columns.find((c) => c.groupBy !== undefined);
}

/** Case-insensitive substring match over the module's searchable text (default: the name). */
export function filterMembers(
    rows: readonly HubMemberRow[],
    query: string,
    searchText?: (row: HubMemberRow) => string,
): readonly HubMemberRow[] {
    const q = query.trim().toLowerCase();
    if (q === '') return rows;
    return rows.filter((row) => (searchText ? searchText(row) : row.name).toLowerCase().includes(q));
}

/**
 * Band the rows. Without a grouping function the whole list is one unlabelled
 * band; with one, bands appear in the order their first row does, so the
 * module's row order (WoW: rank ascending from the server) is preserved.
 */
export function bandMembers(
    rows: readonly HubMemberRow[],
    groupBy: HubMemberColumn['groupBy'],
): readonly HubMemberBand[] {
    if (!groupBy) return rows.length === 0 ? [] : [{ key: 'all', label: '', testId: 'guild-members-all', rows }];
    const byKey = new Map<string, { key: string; label: string; testId: string; rows: HubMemberRow[] }>();
    const order: string[] = [];
    for (const row of rows) {
        const group = groupBy(row);
        const band = byKey.get(group.key);
        if (band) {
            band.rows.push(row);
            continue;
        }
        byKey.set(group.key, {
            key: group.key,
            label: group.label,
            testId: group.testId ?? `guild-group-${group.key}`,
            rows: [row],
        });
        order.push(group.key);
    }
    return order.flatMap((key) => {
        const band = byKey.get(key);
        return band ? [band] : [];
    });
}

/**
 * ROK-1831: the count line for the rows the page carried. A visitor on a
 * members-first hub gets no rows, so it falls back to the page's member COUNT.
 */
export function membersCountFor(shown: number, loaded: number, memberCount: number): string {
    return loaded === 0 ? membersCountLine(memberCount, memberCount) : membersCountLine(shown, loaded);
}

/** "142 members", or "7 of 142 members" while the search narrows the list. */
export function membersCountLine(shown: number, total: number): string {
    const noun = total === 1 ? 'member' : 'members';
    return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}

/** ROK-1173 — the default sort: the module's own row order (WoW: rank). */
export const DEFAULT_MEMBER_SORT_ID = 'rank';

/**
 * ROK-1173 D5 — the list goes flat (one band, no rank headings) while the
 * search, a filter or a non-default sort is active; back to bands when all
 * three are cleared.
 */
export function isFlatMode(query: string, activeCount: number, sortId: string): boolean {
    return query.trim() !== '' || activeCount > 0 || sortId !== DEFAULT_MEMBER_SORT_ID;
}

const byName = (a: HubMemberRow, b: HubMemberRow): number => a.name.localeCompare(b.name);

/** Rows with no `level` sort after every levelled row in both directions. */
function levelOf(row: HubMemberRow, missing: number): number {
    return row.level ?? missing;
}

/** Last seen: online first, then fewest days since; unreported last. */
function lastSeenRank(row: HubMemberRow): number {
    const p = row.presence;
    if (!p) return Number.POSITIVE_INFINITY;
    if (p.online === true) return -1;
    return p.lastOnlineDays ?? Number.POSITIVE_INFINITY;
}

/** Sorts core offers on every hub; a module appends `MEMBER_SORT_PRESETS` entries it wants. */
export const CORE_MEMBER_SORTS = {
    nameAsc: { id: 'name-asc', label: 'Name A–Z', compare: byName },
    nameDesc: { id: 'name-desc', label: 'Name Z–A', compare: (a, b) => byName(b, a) },
} as const satisfies Record<string, HubMemberSort>;

/** Sorts over `GuildMemberRow` fields a module may opt into via `memberSorts`. */
export const MEMBER_SORT_PRESETS = {
    levelDesc: { id: 'level-desc', label: 'Level high→low', compare: (a, b) => levelOf(b, -1) - levelOf(a, -1) },
    levelAsc: { id: 'level-asc', label: 'Level low→high', compare: (a, b) => levelOf(a, Infinity) - levelOf(b, Infinity) },
    lastSeen: { id: 'last-seen', label: 'Last seen', compare: (a, b) => lastSeenRank(a) - lastSeenRank(b) },
} as const satisfies Record<string, HubMemberSort>;

/** The "Sort by" options: the module order (named after its grouping column), Name A–Z / Z–A, then the module's. */
export function memberSortOptions(groupLabel: string | null, extra: readonly HubMemberSort[] = []): readonly HubMemberSort[] {
    const first: HubMemberSort = { id: DEFAULT_MEMBER_SORT_ID, label: groupLabel ?? 'Default' };
    return [first, CORE_MEMBER_SORTS.nameAsc, CORE_MEMBER_SORTS.nameDesc, ...extra];
}

/** Stable sort; ties break by name. No `compare` keeps the module's order. */
export function sortMembers(rows: readonly HubMemberRow[], sort: HubMemberSort | undefined): readonly HubMemberRow[] {
    const compare = sort?.compare;
    if (!compare) return rows;
    return [...rows].sort((a, b) => {
        const d = compare(a, b);
        return Number.isNaN(d) || d === 0 ? byName(a, b) : d;
    });
}
