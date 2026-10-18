/**
 * ROK-1831 — the game-server Members columns, read from `GuildMemberRow.server`.
 * Each cell reads on its own (phone card rule in `HubMemberColumn`); online is
 * a dot AND the word, never colour alone. No `groupBy`: one flat list.
 */
import type { JSX } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { HubMemberColumn, HubMemberRow } from '../../hub-module';

function CharacterCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span data-testid="server-member-character">{row.server?.characterName ?? '—'}</span>;
}

function OnlineCell({ row }: { row: HubMemberRow }): JSX.Element {
    const online = row.server?.onlineNow === true;
    return (
        <span className="inline-flex items-center gap-1.5" data-testid="server-member-online">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-faint'}`} />
            {online ? 'Online' : 'Offline'}
        </span>
    );
}

/** "Last seen 3 days ago", or "Joined, not played yet" when presence never saw them. */
export function lastSeenLabel(row: HubMemberRow): string {
    const at = row.server?.lastSeenAt ?? null;
    if (at === null) return 'Joined, not played yet';
    return `Last seen ${formatDistanceToNow(new Date(at), { addSuffix: true })}`;
}

function LastSeenCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span data-testid="server-member-last-seen">{lastSeenLabel(row)}</span>;
}

export const SERVER_MEMBER_COLUMNS: readonly HubMemberColumn[] = [
    { id: 'character', header: 'Character', cell: CharacterCell },
    { id: 'online', header: 'Online now', cell: OnlineCell },
    { id: 'last-seen', header: 'Last seen', cell: LastSeenCell },
];
