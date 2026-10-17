/**
 * ROK-1830 — the WoW guild's Members cells: the role summary band and the
 * per-row cells (character link, level + class, the Main
 * pill and the role badge). Core owns the section, card and collapse frame.
 */
import type { JSX } from 'react';
import type { HubCtx, HubMemberRow } from '../../hub-module';
import { Pill } from '../../../components/hub/hub-bits';
import { CharacterLink } from '../../../components/hub/character-link';
import { CharRoleBadge, RoleSummary } from './role-bits';

function memberFacts(m: HubMemberRow): string {
    return [m.level === null ? null : `Lv ${m.level}`, m.class].filter(Boolean).join(' ');
}

export function NameCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <CharacterLink name={row.name} characterId={row.characterId} />;
}

export function FactsCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span className="text-xs text-muted">{memberFacts(row)}</span>;
}

export function MainCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    return row.isMain ? <Pill>Main</Pill> : null;
}

export function RoleCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    return row.effectiveRole ? <span className="ml-auto"><CharRoleBadge role={row.effectiveRole} /></span> : null;
}

export function WowRoleSummaryBand({ page }: HubCtx): JSX.Element {
    return <RoleSummary counts={page.roleCounts} />;
}
