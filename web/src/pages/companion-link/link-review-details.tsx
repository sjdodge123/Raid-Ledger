/** ROK-1955 — the computer's details on the `/link` review card. */
import type { JSX } from 'react';
import type { CompanionLinkPreview } from '@raid-ledger/contract';
import { systemLine, timingLine } from './companion-link-code';

/** System / Requested / From rows. A different network reads in the warning colour. */
export function LinkReviewDetails({ preview, nowMs }: { preview: CompanionLinkPreview; nowMs: number }): JSX.Element {
    const network = preview.sameNetworkAsYou
        ? `Network ${preview.requestedNetwork} — the same network as you`
        : `Network ${preview.requestedNetwork} — a different network from yours`;
    return (
        <dl className="my-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted">System</dt>
            <dd className="text-foreground">{systemLine(preview.device)}</dd>
            <dt className="text-muted">Requested</dt>
            <dd className="text-foreground">{timingLine(preview, nowMs)}</dd>
            <dt className="text-muted">From</dt>
            <dd className={preview.sameNetworkAsYou ? 'text-muted' : 'text-warning'}>{network}</dd>
        </dl>
    );
}

/** The always-shown phishing warning; headed when the network differs. */
export function LinkWarningBanner({ differentNetwork }: { differentNetwork: boolean }): JSX.Element {
    return (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            {differentNetwork && <><strong>A different network from yours.</strong>{' '}</>}
            Only approve if you started this on your own computer just now. Never approve a code someone sent you.
        </div>
    );
}
