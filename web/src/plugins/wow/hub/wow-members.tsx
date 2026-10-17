/**
 * ROK-1830 — the WoW guild's Members contributions: rank groups, the role
 * summary band, and the per-row cells (character link, level + class, the Main
 * pill and the role badge). Core owns the section, card and collapse frame.
 */
import type { JSX } from 'react';
import type { GuildPage } from '@raid-ledger/contract';
import type { HubCtx, HubMemberColumn, HubMemberGroup, HubMemberRow } from '../../hub-module';
import { Pill } from '../../../components/hub/hub-bits';
import { CharacterLink } from './character-link';
import { CharRoleBadge, RoleSummary } from './role-bits';
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

function memberFacts(m: HubMemberRow): string {
    return [m.level === null ? null : `Lv ${m.level}`, m.class].filter(Boolean).join(' ');
}

function NameCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <CharacterLink name={row.name} characterId={row.characterId} />;
}

function FactsCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span className="text-xs text-muted">{memberFacts(row)}</span>;
}

function MainCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    return row.isMain ? <Pill>Main</Pill> : null;
}

function RoleCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    return row.effectiveRole ? <span className="ml-auto"><CharRoleBadge role={row.effectiveRole} /></span> : null;
}

export const WOW_MEMBER_COLUMNS: readonly HubMemberColumn[] = [
    { id: 'name', cell: NameCell },
    { id: 'facts', cell: FactsCell },
    { id: 'main', cell: MainCell },
    { id: 'role', cell: RoleCell },
];

export function WowRoleSummaryBand({ page }: HubCtx): JSX.Element {
    return <RoleSummary counts={page.roleCounts} />;
}
