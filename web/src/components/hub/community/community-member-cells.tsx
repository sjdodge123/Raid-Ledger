/**
 * ROK-1870 §3.1 — the community Members columns, read from
 * `GuildMemberRow.community`. Each cell reads on its own (the phone-card rule
 * in `HubMemberColumn`). Role is a chip AND the word, never colour alone.
 */
import type { JSX } from 'react';
import type { HubMemberRow } from '../../../plugins/hub-module';
import { StatusChip } from '../../ui/status-chip';

const ROLE_LABEL = { leader: 'Leader', officer: 'Officer', member: 'Member' } as const;

/** ROK-1893 — how a member joined; `manual` (Join button) and pre-1893 rows show nothing. */
const JOIN_SOURCE_LABEL = { invite: 'Invite', auto: 'Auto', prompt: 'Prompt' } as const;
const JOIN_SOURCE_TITLE = { invite: 'Joined through an invite link', auto: 'Joined automatically by signing up for a hub event', prompt: 'Joined from the “Join this hub?” prompt' } as const;

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
    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-muted" data-testid="community-member-joined">Joined {label}</span>
            <JoinSourceChip row={row} />
        </span>
    );
}

/** A neutral chip naming how the member joined (invite / auto / prompt). */
export function JoinSourceChip({ row }: { row: HubMemberRow }): JSX.Element | null {
    const source = row.community?.joinSource;
    if (source === undefined || source === null || source === 'manual') return null;
    return (
        <StatusChip tone="neutral" title={JOIN_SOURCE_TITLE[source]}>
            <span data-testid="community-member-join-source">{JOIN_SOURCE_LABEL[source]}</span>
        </StatusChip>
    );
}
