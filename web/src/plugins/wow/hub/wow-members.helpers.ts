/**
 * ROK-1830 — how a WoW guild's members read in the core Members frame: the
 * flat row list (server order, rank ascending), the rank column that also
 * bands the list, the role-coloured row rule and what the search box matches.
 */
import type { GuildPage } from '@raid-ledger/contract';
import type { HubMemberColumn, HubMemberGrouping, HubMemberRow } from '../../hub-module';
import { FactsCell, MainCell, NameCell, RankCell, RoleCell } from './wow-members';
import { ROLE_META, rankLabel } from './wow-guild.helpers';

export const WOW_MEMBERS_EMPTY = 'No members yet. Import a LedgerLink guild export to fill the roster.';

export function wowMembersBlurb(page: GuildPage): string {
    return `${page.guild.memberCount} members · ranks from the latest LedgerLink export`;
}

/** The server already orders the groups by rank, so flattening keeps that order. */
export function wowMemberRows(page: GuildPage): readonly HubMemberRow[] {
    return page.ranks.flatMap((group) => group.members);
}

/** One band per guild rank; the test id predates the Members rename and is kept. */
export function wowRankGroup(row: HubMemberRow): HubMemberGrouping {
    const key = String(row.rankIndex ?? 'none');
    return { key, label: rankLabel(row), testId: `guild-rank-${key}` };
}

export function wowMemberRowClass(row: HubMemberRow): string {
    return row.effectiveRole ? ROLE_META[row.effectiveRole].cls : 'border-edge-subtle';
}

/** Name, class and rank — what the prototype's "Search members or class" box covers. */
export function wowMemberSearch(row: HubMemberRow): string {
    return [row.name, row.class, row.rankName].filter((v) => v !== null && v !== '').join(' ');
}

export const WOW_MEMBER_COLUMNS: readonly HubMemberColumn[] = [
    { id: 'name', header: 'Name', cell: NameCell },
    { id: 'facts', header: 'Class', cell: FactsCell },
    { id: 'rank', header: 'Rank', cell: RankCell, groupBy: wowRankGroup },
    { id: 'main', header: 'Main', cell: MainCell },
    { id: 'role', header: 'Raid role', cell: RoleCell },
];
