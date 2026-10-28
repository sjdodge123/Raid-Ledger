/**
 * ROK-1919 — WoW: Forever "Recent dings" Overview card body. One row per
 * level-up in the last 30 days, newest first: the member's name (a
 * `CharacterLink` when they own a Raid Ledger character, plain text
 * otherwise) · "hit 41" · when it was seen ("2 h ago", the shared
 * `syncedAgo` wording). The time is when the roster export arrived, not the
 * real ding (unknown), so its `title` says so (spec Q3). Only current
 * members show (ROK-2035: the server drops dings of members who have left).
 * Core draws the `WidgetCard` chrome; every hub viewer sees it (spec D7).
 */
import type { JSX } from 'react';
import type { WowRecentDingsDto } from '@raid-ledger/contract';
import { CharacterLink } from '../../../components/hub/character-link';
import { syncedAgo } from '../../../lib/synced-ago';
import type { HubWidgetCtx } from '../../hub-game-widgets';
import { useRecentDings } from './use-recent-dings';

type Ding = WowRecentDingsDto['dings'][number];

/** The Recent dings widget body (lazy-loaded). */
export default function RecentDingsWidget({ page }: Pick<HubWidgetCtx, 'page'>): JSX.Element {
    const { data, isPending, isError } = useRecentDings(page.guild.id);
    if (isPending) return <div className="h-24 animate-pulse rounded-md bg-panel" />;
    if (isError) return <p role="alert" className="text-sm text-muted">Couldn't load recent dings.</p>;
    if (data.dings.length === 0) {
        return (
            <div data-testid="recent-dings-empty" className="flex flex-col gap-1">
                <p className="text-sm text-muted">No level-ups seen in the last 30 days.</p>
                <p className="text-xs text-dim">Dings show up here when an officer re-exports the roster from LedgerLink.</p>
            </div>
        );
    }
    return (
        <ul className="divide-y divide-edge" aria-label="Recent dings">
            {data.dings.map((d, i) => <DingRow key={`${d.name}:${d.toLevel}:${d.at}:${i}`} ding={d} />)}
        </ul>
    );
}

function DingRow({ ding }: { ding: Ding }): JSX.Element {
    return (
        <li data-testid="recent-ding" className="flex min-h-11 items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
                <CharacterLink name={ding.name} characterId={ding.characterId} className="inline-block min-w-0 max-w-full truncate py-3 align-middle font-medium leading-5 text-foreground" />
                <span className="shrink-0 text-muted">hit {ding.toLevel}</span>
            </span>
            <time data-testid="recent-ding-time" dateTime={ding.at}
                title={`Seen in the roster export at ${new Date(ding.at).toLocaleString()}`}
                className="shrink-0 text-xs text-dim">
                {syncedAgo(ding.at)}
            </time>
        </li>
    );
}
