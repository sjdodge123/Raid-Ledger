/**
 * ROK-2099 — pure helpers for the Addon errors page: filter state ↔ API
 * filters, the funnel's option lists, the summary line and "last seen" dates.
 */
import type { AddonErrorGroupDto, AddonErrorGroupPageDto, AddonErrorsFiltersDto } from '@raid-ledger/contract';

/** "Last seen" window in days; `any` sends no `since`. */
export type LastSeenWindow = 'any' | '7' | '30' | '90';

export interface AddonErrorsFilterState {
    /** Exact addon name; '' = all. */
    addon: string;
    /** Uploader user id as a string; '' = all. */
    userId: string;
    lastSeen: LastSeenWindow;
}

export const EMPTY_ADDON_ERROR_FILTERS: AddonErrorsFilterState = { addon: '', userId: '', lastSeen: 'any' };

export const LAST_SEEN_OPTIONS: readonly { value: LastSeenWindow; label: string }[] = [
    { value: 'any', label: 'Any time' },
    { value: '7', label: 'Last 7 days' },
    { value: '30', label: 'Last 30 days' },
    { value: '90', label: 'Last 90 days' },
];

const DAY_MS = 86_400_000;

export function activeFilterCount(f: AddonErrorsFilterState): number {
    return [f.addon !== '', f.userId !== '', f.lastSeen !== 'any'].filter(Boolean).length;
}

/** Page state → the API's filter DTO (empty values omitted). */
export function toApiFilters(f: AddonErrorsFilterState, q: string, now: Date = new Date()): AddonErrorsFiltersDto {
    const query = q.trim();
    return {
        ...(f.addon ? { addon: f.addon } : {}),
        ...(f.userId ? { userId: Number(f.userId) } : {}),
        ...(f.lastSeen !== 'any' ? { since: new Date(now.getTime() - Number(f.lastSeen) * DAY_MS).toISOString() } : {}),
        ...(query ? { q: query } : {}),
    };
}

export interface FilterOption { value: string; label: string }

const byLabel = (a: FilterOption, b: FilterOption): number => a.label.localeCompare(b.label);

/** Addons seen on the loaded page, A–Z, always keeping the selected one. */
export function addonOptions(groups: readonly AddonErrorGroupDto[], selected: string): FilterOption[] {
    const names = new Set(groups.map((g) => g.addon));
    if (selected) names.add(selected);
    return [...names].map((n) => ({ value: n, label: n })).sort(byLabel);
}

/** Members seen on the loaded page, A–Z, always keeping the selected one. */
export function memberOptions(groups: readonly AddonErrorGroupDto[], selected: string): FilterOption[] {
    const byId = new Map<string, string>();
    for (const g of groups) for (const m of g.members) byId.set(String(m.userId), m.username);
    if (selected && !byId.has(selected)) byId.set(selected, `Member ${selected}`);
    return [...byId].map(([value, label]) => ({ value, label })).sort(byLabel);
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "4 distinct errors · 61 occurrences · 3 members" — occurrences and members count the loaded page. */
export function summaryLine(page: AddonErrorGroupPageDto): string {
    const occurrences = page.items.reduce((sum, g) => sum + g.totalCount, 0);
    const members = new Set(page.items.flatMap((g) => g.members.map((m) => m.userId))).size;
    return [plural(page.total, 'distinct error'), plural(occurrences, 'occurrence'), plural(members, 'member')].join(' · ');
}

const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

/** "Today 13:49", "Yesterday 21:02", else "Nov 2". */
export function formatSeen(iso: string, now: Date = new Date()): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    if (sameDay(d, now)) return `Today ${time}`;
    if (sameDay(d, new Date(now.getTime() - DAY_MS))) return `Yesterday ${time}`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
