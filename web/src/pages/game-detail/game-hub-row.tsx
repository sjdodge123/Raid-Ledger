/**
 * ROK-1883 — one row of the game page's Hubs card (spec §2.4): name link over
 * "N members · blurb", the kind chip (+ Hidden for staff) and the shared
 * viewer action. Below 640px the chips wrap under the name; the action stays
 * on the right.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { HubKindChip } from '../../components/layout/hub-nav/hub-kind-chip';
import { guildHref, memberCountLabel } from '../../components/layout/hub-nav/my-hubs-queries';
import { HubHiddenChip, HubViewerAction, type HubViewerActionProps } from '../../components/hub/hub-row-bits';

/** A Hubs-card row; `data-hub-id` lets tests assert no hub renders twice. */
export function GameHubRow(props: HubViewerActionProps): JSX.Element {
    const { hub } = props;
    const meta = hub.blurb ? `${memberCountLabel(hub.memberCount)} · ${hub.blurb}` : memberCountLabel(hub.memberCount);
    return (
        <li className="flex items-center gap-3 py-2" data-testid="game-hub-row" data-hub-id={hub.id}>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                    <Link to={guildHref(hub.id)} className="block truncate text-sm font-medium text-foreground hover:underline">{hub.name}</Link>
                    <p className="truncate text-xs text-muted">{meta}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                    <HubKindChip kind={hub.kind} />
                    <HubHiddenChip hub={hub} />
                </span>
            </div>
            <div className="shrink-0"><HubViewerAction {...props} /></div>
        </li>
    );
}
