/**
 * ROK-1785/ROK-1830 — the Members tab frame (D7-A: the tab the page used to
 * call "Roster"). Core owns the card, the search box, the filter opener, the
 * sort, the grouping toggle and the count line; the hub module says which rows
 * there are, what each column holds, how rows group, what text the search
 * matches and (ROK-1173) which filters and extra sorts it offers.
 *
 * ROK-1173 D5: rank bands while idle; one flat list while a search, a filter
 * or a non-default sort is active. The list is windowed in both modes.
 *
 * Two shells, one column set: the §4.21 box table from 1024px up, §4.18
 * stacked cards below it — exactly one is mounted, so a selector never
 * matches a hidden copy.
 */
import { createContext, useContext, useMemo, useState, type JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx, HubMemberColumn, HubMemberFilters, HubMemberRow, HubMemberSort, HubModule } from '../../plugins/hub-module';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { Checkbox } from '../ui/checkbox';
import { FilterEntry, FilterEntryTrigger } from '../ui/filter-entry';
import { SearchInput } from '../ui/search-input';
import { Card, SectionTitle } from './hub-bits';
import { MemberSortSelect } from './hub-member-sort';
import { HubMemberVirtualList } from './hub-member-virtual-list';
import { memberCountLabel } from '../layout/hub-nav/my-hubs-queries';
import {
    bandMembers, DEFAULT_MEMBER_SORT_ID, filterMembers, groupingColumn, isFlatMode, memberSortOptions, membersCountFor, sortMembers,
} from './hub-members.helpers';

const NO_FILTERS: HubMemberFilters = { activeCount: 0, matches: () => true, clearAll: () => undefined, controls: null };

/** Stand-in for a module without `useMemberFilters` (keeps the hook call unconditional). */
function useNoMemberFilters(): HubMemberFilters {
    return NO_FILTERS;
}

interface FilterOpen { open: boolean; setOpen: (open: boolean) => void }

interface ToolsProps {
    query: string;
    onQuery: (q: string) => void;
    /** Null when the module offers no filters — no funnel then. */
    filters: (FilterOpen & { activeCount: number }) | null;
    sorts: readonly HubMemberSort[];
    sortId: string;
    onSort: (id: string) => void;
    /** Null hides the toggle (no grouping column, or the list is flat). */
    groupLabel: string | null;
    grouped: boolean;
    onGrouped: (on: boolean) => void;
}

/** Search + funnel (1024px and up), then sort + the grouping toggle; wraps onto two rows on a phone. */
function MemberTools(p: ToolsProps): JSX.Element {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex w-full max-w-sm items-center gap-2">
                <div className="min-w-0 flex-1">
                    <SearchInput value={p.query} onChange={p.onQuery} label="Search members" placeholder="Search members" />
                </div>
                {p.filters && <FilterEntryTrigger activeCount={p.filters.activeCount} isOpen={p.filters.open} onOpenChange={p.filters.setOpen} />}
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <MemberSortSelect sorts={p.sorts} value={p.sortId} onChange={p.onSort} />
                {p.groupLabel !== null && (
                    <Checkbox checked={p.grouped} onChange={(e) => p.onGrouped(e.target.checked)}
                        label={`Group by ${p.groupLabel.toLowerCase()}`} data-testid="guild-members-group-toggle" />
                )}
            </div>
        </div>
    );
}

/** The module's empty line for this page (core default when it gives none). */
function emptyLine(mod: HubModule | undefined, page: GuildPage): string {
    const empty = mod?.membersEmpty;
    if (typeof empty === 'function') return empty(page);
    return empty ?? 'No members yet.';
}

interface ActionsValue { ctx: HubCtx; Actions: NonNullable<HubModule['memberActions']> }

/** Feeds the row-action cell without rebuilding the column (a new column would remount an open menu). */
const MemberActionsContext = createContext<ActionsValue | null>(null);

function MemberActionsCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    const value = useContext(MemberActionsContext);
    if (value === null) return null;
    return <value.Actions row={row} ctx={value.ctx} />;
}

const ACTIONS_COLUMN: HubMemberColumn = { id: 'actions', header: '', cell: MemberActionsCell };

/** The module's columns plus its row-action column (ROK-1870 `memberActions`). */
function useMemberColumns(mod: HubModule | undefined): readonly HubMemberColumn[] {
    const hasActions = mod?.memberActions !== undefined;
    const base = mod?.memberColumns;
    return useMemo(() => (hasActions ? [...(base ?? []), ACTIONS_COLUMN] : base ?? []), [hasActions, base]);
}

/** Columns (with the row-action column, if any) plus the value the action cells read. */
function useMemberActions(mod: HubModule | undefined, ctx: HubCtx): { columns: readonly HubMemberColumn[]; actionsValue: ActionsValue | null } {
    const columns = useMemberColumns(mod);
    const Actions = mod?.memberActions;
    const actionsValue = useMemo(() => (Actions ? { ctx, Actions } : null), [Actions, ctx]);
    return { columns, actionsValue };
}

/** The "no members" or "no match" line, when one applies — a filter-only miss says so too (AC10). */
function MembersStatusLine({ total, shown, query, empty }: { total: number; shown: number; query: string; empty: string }): JSX.Element | null {
    if (total === 0) return <p className="py-6 text-center text-sm text-muted" data-testid="guild-members-empty">{empty}</p>;
    if (shown > 0) return null;
    const q = query.trim();
    return (
        <p className="py-6 text-center text-sm text-muted" data-testid="guild-members-no-match">
            {q !== '' ? `No members match “${q}”.` : 'No members match these filters.'}
        </p>
    );
}

/** Search + filter + sort state, and the rows/bands they leave. */
function useMembersView(mod: HubModule | undefined, ctx: HubCtx, columns: readonly HubMemberColumn[]) {
    const [query, setQuery] = useState('');
    const [sortId, setSortId] = useState(DEFAULT_MEMBER_SORT_ID);
    const [grouped, setGrouped] = useState(true);
    const [open, setOpen] = useState(false);
    const allRows = useMemo(() => mod?.memberRows(ctx.page) ?? [], [mod, ctx.page]);
    const useFilters = mod?.useMemberFilters ?? useNoMemberFilters;
    const filters = useFilters(ctx, allRows);
    const groupCol = groupingColumn(columns);
    const sorts = useMemo(() => memberSortOptions(groupCol?.header ?? null, mod?.memberSorts), [groupCol, mod]);
    const flat = isFlatMode(query, filters.activeCount, sortId);
    const sort = sorts.find((s) => s.id === sortId);
    const rows = useMemo(
        () => sortMembers(filterMembers(allRows, query, mod?.memberSearch).filter(filters.matches), sort),
        [allRows, query, mod, filters.matches, sort],
    );
    const bands = useMemo(() => bandMembers(rows, !flat && grouped ? groupCol?.groupBy : undefined), [rows, flat, grouped, groupCol]);
    return { query, setQuery, sortId, setSortId, grouped, setGrouped, open, setOpen, allRows, filters, groupCol, sorts, flat, rows, bands };
}

type MembersView = ReturnType<typeof useMembersView>;

function membersTools(v: MembersView, hasFilters: boolean): ToolsProps {
    return {
        query: v.query, onQuery: v.setQuery, sorts: v.sorts, sortId: v.sortId, onSort: v.setSortId,
        filters: hasFilters ? { open: v.open, setOpen: v.setOpen, activeCount: v.filters.activeCount } : null,
        groupLabel: v.flat ? null : v.groupCol?.header ?? null, grouped: v.grouped, onGrouped: v.setGrouped,
    };
}

/** Remounted per module (see `HubMembers`), so the module's filter hook keeps a stable call order. */
function MembersFrame({ ctx, mod }: { ctx: HubCtx; mod: HubModule | undefined }): JSX.Element {
    const page: GuildPage = ctx.page;
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const { columns, actionsValue } = useMemberActions(mod, ctx);
    const v = useMembersView(mod, ctx, columns);
    // No rows (a visitor on a members-first hub): no funnel / FAB with nothing to narrow.
    const hasFilters = mod?.useMemberFilters !== undefined && v.allRows.length > 0;
    const Summary = mod?.membersSummary;
    return (
        <section id="members" className="scroll-mt-4" data-testid="guild-members">
            <SectionTitle title="Members" blurb={mod?.membersBlurb?.(page) ?? memberCountLabel(page.guild.memberCount)} />
            <Card className="flex flex-col gap-3">
                {Summary && <Summary {...ctx} />}
                <MemberTools {...membersTools(v, hasFilters)} />
                {hasFilters && (
                    <FilterEntry activeCount={v.filters.activeCount} isOpen={v.open} onOpenChange={v.setOpen} onClearAll={v.filters.clearAll}>
                        {v.filters.controls}
                    </FilterEntry>
                )}
                {v.filters.lead}
                <p className="text-xs text-muted" data-testid="guild-members-count">{membersCountFor(v.rows.length, v.allRows.length, page.guild.memberCount)}</p>
                <MembersStatusLine total={v.allRows.length} shown={v.rows.length} query={v.query} empty={emptyLine(mod, page)} />
                {v.rows.length > 0 && (
                    <MemberActionsContext.Provider value={actionsValue}>
                        <HubMemberVirtualList bands={v.bands} columns={columns} rowClass={mod?.memberRowClass} desktop={isDesktop} />
                    </MemberActionsContext.Provider>
                )}
            </Card>
        </section>
    );
}

export function HubMembers({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    return <MembersFrame key={mod?.kind ?? 'none'} ctx={ctx} mod={mod} />;
}
