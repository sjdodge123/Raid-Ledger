/**
 * ROK-1464 AC8 — the LFG group page's non-happy states.
 *
 * Split out of the page so the page file reads as composition. The pending
 * card is the visible half of D3's failure story: the poll EXISTS, so the link
 * to it must survive a failed convert.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { PendingConvert } from '../../hooks/use-lfg-actions';
import { LFG_COPY } from './lfg-copy';

/** Skeleton while the slug (and then the group) resolves. */
export function LfgLoading(): JSX.Element {
    return (
        <div
            data-testid="lfg-loading"
            className="mx-auto max-w-4xl animate-pulse space-y-4 px-4 py-6"
        >
            <div className="h-28 rounded-xl bg-overlay" />
            <div className="h-20 rounded-xl bg-overlay" />
            <div className="h-40 rounded-xl bg-overlay" />
        </div>
    );
}

/** Unknown slug: the link is stale, or the game was never added here. */
export function LfgNotFound(): JSX.Element {
    return (
        <div className="mx-auto max-w-4xl px-4 py-8" data-testid="lfg-not-found">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-6">
                <h2 className="text-xl font-semibold text-red-400">
                    {LFG_COPY.notFoundTitle}
                </h2>
                <p className="mt-2 text-muted">{LFG_COPY.notFoundBody}</p>
                <Link
                    to="/games"
                    className="mt-4 inline-block text-emerald-400 hover:text-emerald-300"
                >
                    {LFG_COPY.backToGames}
                </Link>
            </div>
        </div>
    );
}

/** The poll link plus the retry — never one without the other. */
function PendingPollActions({
    pending,
    onRetry,
}: {
    pending: PendingConvert;
    onRetry: () => void;
}): JSX.Element {
    return (
        <div className="flex items-center gap-2">
            <Link
                to={`/community-lineup/${pending.lineupId}/schedule/${pending.matchId}`}
                className="text-sm font-semibold text-emerald-400 hover:text-emerald-300"
            >
                {LFG_COPY.openPoll}
            </Link>
            <button
                type="button"
                onClick={onRetry}
                className="rounded-md bg-overlay px-3 py-1.5 text-sm font-semibold text-zinc-200"
            >
                {LFG_COPY.convertRetry}
            </button>
        </div>
    );
}

/**
 * D3's failure story made visible: the poll exists but the group was never
 * marked converted. Renders nothing while there is nothing to recover.
 */
export function PendingPollCard({
    pending,
    onRetry,
}: {
    pending: PendingConvert | null;
    onRetry: () => void;
}): JSX.Element | null {
    if (!pending) return null;
    return (
        <div
            data-testid="lfg-convert-retry"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
        >
            <p className="text-sm text-amber-200">{LFG_COPY.convertFailed}</p>
            <PendingPollActions pending={pending} onRetry={onRetry} />
        </div>
    );
}
