/**
 * ROK-1830 S3b — the pure parts of the core Members list: the search filter,
 * the banding a grouping column asks for, and the count line. Core knows
 * nothing about what a row means; the hub module supplies the rows, the
 * searchable text and the grouping function.
 */
import type { HubMemberColumn, HubMemberRow } from '../../plugins/hub-module';

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
