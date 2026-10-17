/**
 * ROK-1830 — how a WoW guild's members group and read in the core Members
 * frame: one collapsible band per guild rank, the role-coloured row rule, and
 * the column order (character link · level + class · Main · role badge).
 */
import type { GuildPage } from '@raid-ledger/contract';
import type { HubMemberColumn, HubMemberGroup, HubMemberRow } from '../../hub-module';
import { FactsCell, MainCell, NameCell, RoleCell } from './wow-members';
import { ROLE_META, rankLabel } from './wow-guild.helpers';

const OPEN_RANKS_UP_TO = 2;

export const WOW_MEMBERS_EMPTY = 'No members yet. Import a LedgerLink guild export to fill the roster.';

export function wowMembersBlurb(page: GuildPage): string {
    return `${page.guild.memberCount} members · ranks from the latest LedgerLink export`;
}

export function wowMemberGroups(page: GuildPage): readonly HubMemberGroup[] {
    return page.ranks.map((group) => ({
        key: String(group.rankIndex ?? 'none'),
        label: rankLabel(group),
        testId: `guild-rank-${group.rankIndex ?? 'none'}`,
        defaultOpen: group.rankIndex !== null && group.rankIndex <= OPEN_RANKS_UP_TO,
        rows: group.members,
    }));
}

export function wowMemberRowClass(row: HubMemberRow): string {
    return row.effectiveRole ? ROLE_META[row.effectiveRole].cls : 'border-edge-subtle';
}

export const WOW_MEMBER_COLUMNS: readonly HubMemberColumn[] = [
    { id: 'name', cell: NameCell },
    { id: 'facts', cell: FactsCell },
    { id: 'main', cell: MainCell },
    { id: 'role', cell: RoleCell },
];
