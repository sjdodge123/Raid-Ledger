/**
 * ROK-1870 — one `/hubs` directory card (design-system §4.2): game, hub name
 * (link to the hub page), blurb, member count + Leader, and an inline Join
 * that never navigates.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { Button } from '../components/ui/button';
import { StatusChip } from '../components/ui/status-chip';

function ViewerAction({ hub, onJoin, joining }: HubCardProps): JSX.Element {
    if (hub.viewer === 'banned') return <StatusChip tone="danger" title="You can't join this hub">Banned</StatusChip>;
    if (hub.viewer === 'not-member') {
        return <Button variant="secondary" size="sm" onClick={onJoin} disabled={joining} aria-label={`Join ${hub.name}`}>Join</Button>;
    }
    const label = hub.viewer === 'leader' ? 'Leader' : 'Joined';
    return <StatusChip tone="success" title="You are in this hub">{label}</StatusChip>;
}

export interface HubCardProps {
    hub: HubDirectoryEntry;
    onJoin: () => void;
    joining: boolean;
}

/** A directory card; Join is a sibling of the name link, so clicking it stays on the page. */
export function HubDirectoryCard(props: HubCardProps): JSX.Element {
    const { hub } = props;
    return (
        <article className="flex flex-col gap-2 rounded-lg border border-edge bg-surface p-4" data-testid="hub-directory-card">
            <div className="flex items-center gap-2">
                {hub.gameIconUrl
                    ? <img src={hub.gameIconUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                    : <div className="h-6 w-6 shrink-0 rounded bg-panel" aria-hidden="true" />}
                <span className="truncate text-xs text-muted">{hub.gameName}</span>
            </div>
            <Link to={`/guilds/${hub.id}`} className="text-base font-semibold text-foreground hover:underline">{hub.name}</Link>
            {hub.blurb && <p className="line-clamp-2 text-sm text-secondary">{hub.blurb}</p>}
            <div className="mt-auto flex items-center gap-2 pt-1">
                <span className="flex-1 text-xs text-muted">
                    {hub.memberCount} members{hub.leaderName ? ` · ${hub.leaderName}` : ''}
                </span>
                <ViewerAction {...props} />
            </div>
        </article>
    );
}
