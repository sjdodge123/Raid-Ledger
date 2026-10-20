/** ROK-1836 L4 (D10) — the admin's owner-change history, newest first. */
import type { ValheimClaimEvent } from '@raid-ledger/contract';
import { claimEventAgo, claimEventLabel } from '../lib/valheim-owner.helpers';

function newestFirst(events: ValheimClaimEvent[]): ValheimClaimEvent[] {
    return [...events].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
}

function HistoryRow({ event }: { event: ValheimClaimEvent }) {
    return (
        <li className="flex flex-wrap justify-between gap-2 py-2 text-sm">
            <span className="text-foreground">
                {claimEventLabel(event)}
            </span>
            <time
                dateTime={event.createdAt}
                title={new Date(event.createdAt).toLocaleString()}
                className="text-xs text-dim"
            >
                {claimEventAgo(event.createdAt)}
            </time>
        </li>
    );
}

interface ClaimHistoryProps {
    events: ValheimClaimEvent[] | undefined;
    isError: boolean;
}

function HistoryBody({ events, isError }: ClaimHistoryProps) {
    if (isError)
        return (
            <p className="text-sm text-danger" role="alert">
                Couldn't load the claim history.
            </p>
        );
    if (events === undefined)
        return <p className="text-sm text-muted">Loading history…</p>;
    if (events.length === 0)
        return <p className="text-sm text-muted">No owner changes yet.</p>;
    return (
        <ul
            className="flex flex-col divide-y divide-edge"
            aria-label="Claim history"
        >
            {newestFirst(events).map((e) => (
                <HistoryRow key={e.id} event={e} />
            ))}
        </ul>
    );
}

export function ClaimHistory(props: ClaimHistoryProps) {
    return (
        <section className="mt-6" aria-labelledby="valheim-claim-history">
            <h3
                id="valheim-claim-history"
                className="mb-2 text-sm font-semibold text-foreground"
            >
                Claim history
            </h3>
            <HistoryBody {...props} />
        </section>
    );
}
