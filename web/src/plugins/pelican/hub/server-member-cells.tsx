/**
 * ROK-1831 — the game-server Members columns, read from `GuildMemberRow.server`.
 * Each cell reads on its own (phone card rule in `HubMemberColumn`); online is
 * a dot AND the word, never colour alone. No `groupBy`: one flat list.
 */
import type { JSX } from 'react';
import type { HubMemberRow } from '../../hub-module';
import { lastSeenLabel } from './server-member.helpers';

export function CharacterCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span data-testid="server-member-character">{row.server?.characterName ?? '—'}</span>;
}

export function OnlineCell({ row }: { row: HubMemberRow }): JSX.Element {
    const online = row.server?.onlineNow === true;
    return (
        <span className="inline-flex items-center gap-1.5" data-testid="server-member-online">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-faint'}`} />
            {online ? 'Online' : 'Offline'}
        </span>
    );
}

export function LastSeenCell({ row }: { row: HubMemberRow }): JSX.Element {
    return <span data-testid="server-member-last-seen">{lastSeenLabel(row)}</span>;
}
