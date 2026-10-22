/**
 * ROK-1883 — the per-row bits every hub list shares: the `/hubs` directory
 * card and the game page's Hubs card render the same viewer action and the
 * same staff-only Hidden chip, so the two never drift.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { Button } from '../ui/button';
import { buttonClass } from '../ui/button-classes';
import { StatusChip } from '../ui/status-chip';

/** One hub row's action inputs: the hub, the inline Join and whether it is in flight. */
export interface HubViewerActionProps {
    hub: HubDirectoryEntry;
    onJoin: () => void;
    joining: boolean;
}

function ViewLink({ hub }: { hub: HubDirectoryEntry }): JSX.Element {
    return (
        <Link to={`/guilds/${hub.id}`} aria-label={`View ${hub.name}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            View
        </Link>
    );
}

/**
 * The viewer's action on a hub row (ROK-1875 rule, shared by ROK-1883):
 * server and guild hubs → "View" (membership is presence/character-driven);
 * community hubs → Join / Joined / Leader / Banned.
 */
export function HubViewerAction({ hub, onJoin, joining }: HubViewerActionProps): JSX.Element {
    if (hub.kind !== 'game_community') return <ViewLink hub={hub} />;
    if (hub.viewer === 'banned') return <StatusChip tone="danger" title="You can't join this hub">Banned</StatusChip>;
    if (hub.viewer === 'not-member') {
        return <Button variant="secondary" size="sm" onClick={onJoin} disabled={joining} aria-label={`Join ${hub.name}`}>Join</Button>;
    }
    const label = hub.viewer === 'leader' ? 'Leader' : 'Joined';
    return <StatusChip tone="success" title="You are in this hub">{label}</StatusChip>;
}

/**
 * "Hidden" warning chip for a hub only staff can see. The API sends `hidden`
 * to admins and operators only, so non-staff never render it.
 */
export function HubHiddenChip({ hub }: { hub: HubDirectoryEntry }): JSX.Element | null {
    if (hub.hidden !== true) return null;
    return <StatusChip tone="warning" title="Hidden — only admins and operators can see this hub">Hidden</StatusChip>;
}
