/**
 * ROK-1831 — the server hub's Quick Play tab: past and live sessions on this
 * server (date, length, players), each linking to its event.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { format, formatDistanceStrict } from 'date-fns';
import type { HubQuickPlayItem } from '@raid-ledger/contract';
import type { HubCtx } from '../../hub-module';
import { FOCUS_RING } from '../../../components/ui/form-classes';
import { useHubQuickPlay } from './server-hub-api';

function durationLabel(item: HubQuickPlayItem): string {
    if (item.endedAt === null) return 'Live now';
    return formatDistanceStrict(new Date(item.startedAt), new Date(item.endedAt));
}

function SessionRow({ item }: { item: HubQuickPlayItem }): JSX.Element {
    const players = `${item.participantCount} ${item.participantCount === 1 ? 'player' : 'players'}`;
    return (
        <li data-testid="server-hub-quick-play-row">
            <Link to={`/events/${item.eventId}`}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge bg-panel p-3 hover:bg-surface ${FOCUS_RING}`}>
                <span className="text-sm font-medium text-foreground">{format(new Date(item.startedAt), 'EEE d MMM, HH:mm')}</span>
                <span className="text-sm text-secondary">{durationLabel(item)} · {players}</span>
            </Link>
        </li>
    );
}

/** Tab body; loading skeleton, error line and empty state per design-system §4.5/§4.6. */
export function QuickPlayTab({ page }: HubCtx): JSX.Element {
    const query = useHubQuickPlay(page.guild.id);
    if (query.isPending) return <div aria-busy="true" className="h-24 animate-pulse rounded-lg border border-edge bg-surface" data-testid="server-hub-quick-play-loading" />;
    if (query.isError) return <p role="alert" className="text-sm text-danger">Couldn’t load Quick Play sessions. Try again later.</p>;
    if (query.data.data.length === 0) {
        return <p className="py-8 text-center text-sm text-muted" data-testid="server-hub-quick-play-empty">No Quick Play sessions on this server yet.</p>;
    }
    return <ul className="space-y-2" data-testid="server-hub-quick-play">{query.data.data.map((i) => <SessionRow key={i.eventId} item={i} />)}</ul>;
}
