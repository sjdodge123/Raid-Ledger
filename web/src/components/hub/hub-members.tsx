/**
 * ROK-1785 — the Roster tab: guild members grouped by rank (prototype
 * `MembersByRank.tsx`). Each row is one character in the guild: name (linked
 * when it is a Raid Ledger character, spec D9), level + class, a Main pill and
 * its role badge with a role-coloured left rule. Lower ranks start collapsed.
 */
import type { JSX } from 'react';
import type { GuildMemberRow, GuildPage, GuildRankGroup } from '@raid-ledger/contract';
import { ScrollCollapsible } from '../ui/scroll-collapsible';
import { CharacterLink } from '../../plugins/wow/hub/character-link';
import { Card, Pill, SectionTitle } from './hub-bits';
import { ROLE_META, rankLabel } from '../../plugins/wow/hub/wow-guild.helpers';
import { CharRoleBadge, RoleSummary } from '../../plugins/wow/hub/role-bits';

const OPEN_RANKS_UP_TO = 2;

function memberFacts(m: GuildMemberRow): string {
    return [m.level === null ? null : `Lv ${m.level}`, m.class].filter(Boolean).join(' ');
}

function MemberLine({ m }: { m: GuildMemberRow }): JSX.Element {
    const rule = m.effectiveRole ? ROLE_META[m.effectiveRole].cls : 'border-edge-subtle';
    return (
        <li data-testid="guild-roster-member" className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-l-2 py-1 pl-2 ${rule}`}>
            <CharacterLink name={m.name} characterId={m.characterId} />
            <span className="text-xs text-muted">{memberFacts(m)}</span>
            {m.isMain && <Pill>Main</Pill>}
            {m.effectiveRole && <span className="ml-auto"><CharRoleBadge role={m.effectiveRole} /></span>}
        </li>
    );
}

function RankGroup({ group }: { group: GuildRankGroup }): JSX.Element | null {
    if (group.members.length === 0) return null;
    const name = rankLabel(group);
    const open = group.rankIndex !== null && group.rankIndex <= OPEN_RANKS_UP_TO;
    return (
        <div data-testid={`guild-rank-${group.rankIndex ?? 'none'}`}>
            <ScrollCollapsible title={`${name} · ${group.members.length}`} defaultOpen={open}
                className="border-b border-edge py-2 last:border-b-0">
                <ul aria-label={`${name} members`} className="flex flex-col gap-1 text-sm">
                    {group.members.map((m) => <MemberLine key={m.memberId} m={m} />)}
                </ul>
            </ScrollCollapsible>
        </div>
    );
}

export function GuildRoster({ page }: { page: GuildPage }): JSX.Element {
    const count = page.guild.memberCount;
    return (
        <section id="members" className="scroll-mt-4" data-testid="guild-roster">
            <SectionTitle title="Members" blurb={`${count} members · ranks from the latest LedgerLink export`} />
            <Card className="flex flex-col gap-3">
                <RoleSummary counts={page.roleCounts} />
                {page.ranks.length === 0
                    ? <p className="py-6 text-center text-sm text-muted">No members yet. Import a LedgerLink guild export to fill the roster.</p>
                    : <div>{page.ranks.map((g) => <RankGroup key={g.rankIndex ?? 'none'} group={g} />)}</div>}
            </Card>
        </section>
    );
}
