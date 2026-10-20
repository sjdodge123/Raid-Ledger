/**
 * ROK-1870 §3.1 — the community Members columns, read from
 * `GuildMemberRow.community`. Each cell reads on its own (the phone-card rule
 * in `HubMemberColumn`). Role is a chip AND the word, never colour alone.
 */
import type { JSX } from 'react';
import type { HubMemberColumn, HubMemberRow } from '../../../plugins/hub-module';
import { StatusChip } from '../../ui/status-chip';

const ROLE_LABEL = { leader: 'Leader', officer: 'Officer', member: 'Member' } as const;

export function CommunityPlayerCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span className="font-medium text-foreground" data-testid="community-member-name">{row.name}</span>;
}

export function CommunityRoleCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    const role = row.community?.role;
    if (role === undefined) return null;
    return (
        <StatusChip tone={role === 'member' ? 'neutral' : 'success'} title={`Hub ${ROLE_LABEL[role].toLowerCase()}`}>
            <span data-testid="community-member-role">{ROLE_LABEL[role]}</span>
        </StatusChip>
    );
}

/** "Joined 3 Oct 2026" in the viewer's locale. */
export function CommunityJoinedCell({ row }: { row: HubMemberRow }): JSX.Element | null {
    const at = row.community?.joinedAt;
    if (at === undefined) return null;
    const label = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return <span className="text-muted" data-testid="community-member-joined">Joined {label}</span>;
}

export const COMMUNITY_MEMBER_COLUMNS: readonly HubMemberColumn[] = [
    { id: 'player', header: 'Player', cell: CommunityPlayerCell },
    { id: 'role', header: 'Role', cell: CommunityRoleCell },
    { id: 'joined', header: 'Joined', cell: CommunityJoinedCell },
];
