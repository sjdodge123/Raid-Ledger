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
import { guildHref } from '../layout/hub-nav/my-hubs-queries';
import { hubCopy } from './hub-copy';

/** One hub row's action inputs: the hub, the inline Join and whether it is in flight. */
export interface HubViewerActionProps {
    hub: HubDirectoryEntry;
    onJoin: () => void;
    joining: boolean;
}

function ViewLink({ hub }: { hub: HubDirectoryEntry }): JSX.Element {
    return (
        <Link to={guildHref(hub.id)} aria-label={`View ${hub.name}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            View
        </Link>
    );
}

/** ROK-2132 — the hub page with the gate's "open Add character on the Guild roster tab" flag. */
function claimRosterHref(hubId: number): string {
    return `${guildHref(hubId)}?claim=roster`;
}

/** ROK-2132 Ruling 9 — a non-member's way into a hub whose membership comes from a claimed roster character. */
function ClaimLink({ hub, action }: { hub: HubDirectoryEntry; action: { label: string; short: string } }): JSX.Element {
    return (
        <Link to={claimRosterHref(hub.id)} aria-label={`${action.label}: ${hub.name}`} className={buttonClass({ variant: 'secondary', size: 'sm' })}>
            <span className="sm:hidden">{action.short}</span>
            <span className="hidden sm:inline">{action.label}</span>
        </Link>
    );
}

/**
 * ROK-2132 (Codex P3): a non-member row is claimable only when the API's claim rule
 * chose it. A non-staff viewer is listed a non-member guild only through that rule
 * (`visitorVisibleGroupIds`); staff see every guild (Retail/Classic, hidden, archived)
 * and are told so by the staff-only `hidden` key, so their rows keep "View".
 */
function isClaimableRow(hub: HubDirectoryEntry): boolean {
    return hub.viewer === 'not-member' && hub.hidden === undefined;
}

/**
 * The viewer's action on a hub row (ROK-1875 rule, shared by ROK-1883):
 * server and guild hubs → "View" (membership is presence/character-driven);
 * a WoW guild a non-member can claim into → "Claim your character to join" (ROK-2132);
 * community hubs → Join / Joined / Leader / Banned.
 */
export function HubViewerAction({ hub, onJoin, joining }: HubViewerActionProps): JSX.Element {
    const claim = hubCopy(hub.kind).joinAction;
    if (claim && isClaimableRow(hub)) return <ClaimLink hub={hub} action={claim} />;
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
