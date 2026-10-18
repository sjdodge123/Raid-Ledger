/**
 * ROK-1831 — "Make a community hub" on one Pelican server. On creates (or
 * unhides) the server's hub; off hides it — the same flag as the hub's own
 * "Hide this hub" switch. Disabled with a hint until a game is mapped, unless
 * it is already on (it can always be turned off). On shows an "Open hub" link.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { PelicanServerRowDto } from '@raid-ledger/contract';
import { Switch } from '../../../components/ui/switch';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import type { ServerUpdateHandler } from './pelican-server-row';

export const HUB_NO_GAME_HINT = 'Map a game first';

/** On = the server has a hub that is not hidden. */
export function hubOn(row: PelicanServerRowDto): boolean {
    return row.communityHub != null && !row.communityHub.hidden;
}

function HubHint({ row, id }: { row: PelicanServerRowDto; id: string }): JSX.Element | null {
    const hub = row.communityHub ?? null;
    if (hub !== null && !hub.hidden) {
        return (
            <Link to={`/guilds/${hub.guildId}`} data-testid={`pelican-server-${row.id}-hub-open`}
                className={`rounded-sm text-xs text-success underline underline-offset-2 ${FOCUS_RING}`}>Open hub</Link>
        );
    }
    if (hub !== null) return <p id={id} className="text-xs text-muted" data-testid={`pelican-server-${row.id}-hub-hidden`}>Hidden</p>;
    if (row.gameId === null) return <p id={id} className="text-xs text-muted">{HUB_NO_GAME_HINT}</p>;
    return null;
}

export function CommunityHubSwitch({ row, onUpdate, inline = false }: { row: PelicanServerRowDto; onUpdate: ServerUpdateHandler; inline?: boolean }): JSX.Element {
    const on = hubOn(row);
    const hintId = `pelican-server-${row.id}-hub-hint`;
    const blocked = row.gameId === null && !on;
    return (
        <div className={`flex flex-col gap-1 ${inline ? 'items-start' : 'items-end text-right'}`}
            title={blocked ? HUB_NO_GAME_HINT : undefined}>
            <Switch checked={on} label={`Make ${row.name} a community hub`} testId={`pelican-server-${row.id}-hub`}
                disabled={blocked} aria-describedby={hintId}
                onChange={(communityHub) => onUpdate(row.id, { communityHub })} />
            <HubHint row={row} id={hintId} />
        </div>
    );
}
