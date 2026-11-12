/**
 * ROK-1787 — one ended event in a hub's Recent list: title, when, and its
 * attendance. Shared by the events card and the paged list (ROK-2185).
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { GuildRecentEventDto } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../ui/form-classes';
import { percent, whenLabel } from './guild-raids.helpers';

function recentLabel(e: GuildRecentEventDto): string {
    if (e.attended === null) return `${e.signedUp} signed up · attendance not recorded`;
    return `${e.attended} of ${e.signedUp} attended (${percent(e.attended, e.signedUp)}%)`;
}

/** A Recent-list row (`data-testid="guild-recent-event"`). */
export function RecentRow({ e }: { e: GuildRecentEventDto }): JSX.Element {
    return (
        <li data-testid="guild-recent-event" className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-edge-subtle py-2 text-sm last:border-b-0">
            <span className="min-w-0 text-secondary">
                <Link to={`/events/${e.id}`} className={`rounded-sm font-medium hover:underline ${FOCUS_RING}`}>{e.title}</Link>{' '}
                <span className="text-xs text-dim">· {whenLabel(e.startTime)}</span>
            </span>
            <span className="text-xs text-muted">{recentLabel(e)}</span>
        </li>
    );
}
