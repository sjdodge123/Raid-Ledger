/** ROK-1836 L4 (D10) — the admin's owner-change history, newest first. */
import type { ValheimClaimAction, ValheimClaimEvent } from '@raid-ledger/contract';

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
    return [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

interface ClaimHistoryProps {
    events: ValheimClaimEvent[] | undefined;
    isError: boolean;
}

export function ClaimHistory({ events, isError }: ClaimHistoryProps) {
    let body;
    if (isError) body = <p className="text-sm text-danger" role="alert">Couldn't load the claim history.</p>;
    else if (events === undefined) body = <p className="text-sm text-muted">Loading history…</p>;
    else if (events.length === 0) body = <p className="text-sm text-muted">No owner changes yet.</p>;
    else body = (
        <ul className="flex flex-col divide-y divide-edge" aria-label="Claim history">
            {newestFirst(events).map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span className="text-foreground">{ACTION_LABEL[e.action]}{userText(e.toUserId)}</span>
                    <time dateTime={e.createdAt} className="text-xs text-dim">{new Date(e.createdAt).toLocaleString()}</time>
                </li>
            ))}
        </ul>
    );
    return (
        <section className="mt-6" aria-labelledby="valheim-claim-history">
            <h3 id="valheim-claim-history" className="mb-2 text-sm font-semibold text-foreground">Claim history</h3>
            {body}
        </section>
    );
}
