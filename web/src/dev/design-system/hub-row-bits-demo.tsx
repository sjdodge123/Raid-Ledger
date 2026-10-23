/**
 * Hub row bits for /dev/design-system (docs/design-system.md §5, ROK-1883).
 *
 * The real `HubViewerAction` in each state it ships in — View (server and
 * guild hubs), Join, Joined, Leader, Banned (community hubs) — and the
 * staff-only `HubHiddenChip`. Mock entries only; Join is a no-op here.
 * Tokens only, so it flips with the colour family.
 */
import type { JSX } from 'react';
import type { HubDirectoryEntry } from '@raid-ledger/contract';
import { HubHiddenChip, HubViewerAction } from '../../components/hub/hub-row-bits';
import { StateFrame } from './design-system-bits';

const BASE: HubDirectoryEntry = {
    id: 1, gameId: 5, gameName: "Baldur's Gate 3", gameIconUrl: null, name: 'Tavern Regulars',
    blurb: null, memberCount: 14, leaderName: 'Mirelle', viewer: 'not-member', kind: 'game_community',
};

const STATES: Array<{ label: string; hub: HubDirectoryEntry }> = [
    { label: 'View', hub: { ...BASE, id: 310, name: 'Valheim Dedicated', kind: 'game_server', leaderName: null, hidden: true } },
    { label: 'Join', hub: BASE },
    { label: 'Joined', hub: { ...BASE, id: 2, name: 'Officers Club', viewer: 'member' } },
    { label: 'Leader', hub: { ...BASE, id: 3, name: 'My Own Hub', viewer: 'leader' } },
    { label: 'Banned', hub: { ...BASE, id: 4, name: 'Kicked Out', viewer: 'banned' } },
];

/** One frame: each viewer state beside its hub name; the server hub also carries the Hidden chip. */
export function HubRowBitsDemo(): JSX.Element {
    return (
        <StateFrame label="Hub row — viewer action + Hidden chip" note="hub-row-bits.tsx: shared by /hubs and the game page Hubs card. Hidden renders only when the API sent hidden: true (staff).">
            <ul className="w-full divide-y divide-edge-subtle" data-testid="ds-hub-row-bits">
                {STATES.map(({ label, hub }) => (
                    <li key={label} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="text-sm text-foreground">{hub.name} <span className="text-xs text-muted">({label})</span></span>
                        <span className="flex items-center gap-2">
                            <HubHiddenChip hub={hub} />
                            <HubViewerAction hub={hub} onJoin={() => undefined} joining={false} />
                        </span>
                    </li>
                ))}
            </ul>
        </StateFrame>
    );
}
