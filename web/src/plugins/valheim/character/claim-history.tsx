/** ROK-1836 L4 (D10) — the admin's owner-change history, newest first. */
import type {
    ValheimClaimAction,
    ValheimClaimEvent,
} from '@raid-ledger/contract';

const ACTION_LABEL: Record<ValheimClaimAction, string> = {
    claim: 'Claimed by a member',
    admin_assign: 'Assigned by an admin',
    admin_unassign: 'Owner removed by an admin',
    auto_attach: 'Matched by Steam ID',
    auto_detach: 'Steam match removed',
};

function userText(id: number | null): string {
    return id === null ? '' : ` · user #${id}`;
}

function newestFirst(events: ValheimClaimEvent[]): ValheimClaimEvent[] {
    return [...events].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
}

function HistoryRow({ event }: { event: ValheimClaimEvent }) {
    return (
        <li className="flex flex-wrap justify-between gap-2 py-2 text-sm">
            <span className="text-foreground">
                {ACTION_LABEL[event.action] + userText(event.toUserId)}
            </span>
            <time dateTime={event.createdAt} className="text-xs text-dim">
                {new Date(event.createdAt).toLocaleString()}
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
