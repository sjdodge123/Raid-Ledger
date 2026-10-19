/**
 * ROK-1831 — the server hub's "Recent arrivals" Overview widget: the newest
 * five members by first sighting (operator ruling: first-seen only). Reuses
 * the hub's WidgetCard; tokens only, so both colour families follow the theme.
 */
import type { JSX } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { GuildServerArrival } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { WidgetCard } from '../../../components/hub/hub-bits';

function ArrivalRow({ arrival }: { arrival: GuildServerArrival }): JSX.Element {
    const when = formatDistanceToNow(new Date(arrival.firstSeenAt), { addSuffix: true });
    return (
        <li data-testid="server-hub-arrivals-row" className="flex items-center justify-between gap-2 py-2">
            <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">{arrival.name}</span>
                {arrival.characterName && <span className="block truncate text-xs text-muted">{arrival.characterName}</span>}
            </span>
            <span className="shrink-0 text-xs text-secondary">First seen {when}</span>
        </li>
    );
}

/** Overview widget body; an empty list shows "No arrivals yet". */
export function RecentArrivalsWidget({ page }: HubCtx): JSX.Element {
    const arrivals = page.server?.recentArrivals ?? [];
    return (
        <WidgetCard id="server-hub-arrivals" title="Recent arrivals">
            {arrivals.length === 0
                ? <p className="py-4 text-center text-sm text-muted" data-testid="server-hub-arrivals-empty">No arrivals yet</p>
                : <ul className="divide-y divide-edge-subtle" data-testid="server-hub-arrivals">{arrivals.map((a) => <ArrivalRow key={a.memberId} arrival={a} />)}</ul>}
        </WidgetCard>
    );
}
