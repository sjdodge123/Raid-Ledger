/**
 * ROK-1785/ROK-1830 — the Members tab frame (D7-A: the tab the page used to
 * call "Roster"). Core owns the card, the search box, the grouping toggle and
 * the count line; the hub module says which rows there are, what each column
 * holds, how rows group and what text the search matches.
 *
 * Two shells, one column set: the §4.21 box table from 1024px up, §4.18
 * stacked cards below it — exactly one is mounted, so a selector never
 * matches a hidden copy.
 */
import { createContext, useContext, useMemo, useState, type JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx, HubMemberColumn, HubMemberRow, HubModule } from '../../plugins/hub-module';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { Checkbox } from '../ui/checkbox';
import { SearchInput } from '../ui/search-input';
import { Card, SectionTitle } from './hub-bits';
import { HubMemberCards, HubMemberTable } from './hub-member-table';
import { bandMembers, filterMembers, groupingColumn, membersCountFor } from './hub-members.helpers';

interface ToolsProps {
    query: string;
    onQuery: (q: string) => void;
    groupLabel: string | null;
    grouped: boolean;
    onGrouped: (on: boolean) => void;
}

/** Search + the module's grouping toggle, wrapping onto two rows on a phone. */
function MemberTools({ query, onQuery, groupLabel, grouped, onGrouped }: ToolsProps): JSX.Element {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full max-w-xs">
                <SearchInput value={query} onChange={onQuery} label="Search members" placeholder="Search members" />
            </div>
            {groupLabel !== null && (
                <Checkbox checked={grouped} onChange={(e) => onGrouped(e.target.checked)}
                    label={`Group by ${groupLabel.toLowerCase()}`} data-testid="guild-members-group-toggle" />
            )}
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

export function HubMembers({ ctx, module: mod }: { ctx: HubCtx; module: HubModule | undefined }): JSX.Element {
    const page: GuildPage = ctx.page;
    const [query, setQuery] = useState('');
    const [grouped, setGrouped] = useState(true);
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const columns = useMemberColumns(mod);
    const Actions = mod?.memberActions;
    const actionsValue = useMemo(() => (Actions ? { ctx, Actions } : null), [Actions, ctx]);
    const allRows = mod?.memberRows(page) ?? [];
    const rows = filterMembers(allRows, query, mod?.memberSearch);
    const groupCol = groupingColumn(columns);
    const bands = bandMembers(rows, grouped ? groupCol?.groupBy : undefined);
    const Summary = mod?.membersSummary;
    const List = isDesktop ? HubMemberTable : HubMemberCards;
    return (
        <section id="members" className="scroll-mt-4" data-testid="guild-members">
            <SectionTitle title="Members" blurb={mod?.membersBlurb?.(page) ?? `${page.guild.memberCount} members`} />
            <Card className="flex flex-col gap-3">
                {Summary && <Summary {...ctx} />}
                <MemberTools query={query} onQuery={setQuery} grouped={grouped} onGrouped={setGrouped}
                    groupLabel={groupCol?.header ?? null} />
                <p className="text-xs text-muted" data-testid="guild-members-count">{membersCountFor(rows.length, allRows.length, page.guild.memberCount)}</p>
                {allRows.length === 0 && <p className="py-6 text-center text-sm text-muted" data-testid="guild-members-empty">{emptyLine(mod, page)}</p>}
                {allRows.length > 0 && rows.length === 0 && (
                    <p className="py-6 text-center text-sm text-muted" data-testid="guild-members-no-match">No members match “{query.trim()}”.</p>
                )}
                {rows.length > 0 && (
                    <MemberActionsContext.Provider value={actionsValue}>
                        <List bands={bands} columns={columns} rowClass={mod?.memberRowClass} />
                    </MemberActionsContext.Provider>
                )}
            </Card>
        </section>
    );
}
