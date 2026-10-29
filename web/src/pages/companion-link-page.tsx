/**
 * ROK-1955 — `/link`: approve a Raid Ledger Companion computer (RFC 8628).
 *
 * The app shows an 8-letter code; the user types it here (or arrives with
 * `#code=` pre-filled), checks the computer's details and clicks Approve.
 * A pre-filled code never approves on its own. Expiry is the server's call:
 * a client clock past `expiresAt` only adds a hint and never hides Approve.
 */
import type { JSX } from 'react';
import { companionLinkErrorKind } from '../hooks/use-companion-link';
import { LinkEntryCard } from './companion-link/link-entry-card';
import { LINK_ERROR_COPY } from './companion-link/link-copy';
import { LinkResultCard } from './companion-link/link-result-card';
import { LinkReviewCard } from './companion-link/link-review-card';
import { useLinkFlow, useNow } from './companion-link/use-link-flow';

/** The card for the current step of the flow. */
function LinkStep(): JSX.Element {
    const flow = useLinkFlow();
    const nowMs = useNow(15_000);
    const { preview, decision } = flow;
    if (decision.data) return <LinkResultCard status={decision.data.status} />;
    if (preview.data) {
        return (
            <LinkReviewCard
                preview={preview.data}
                nowMs={nowMs}
                pending={decision.isPending ? decision.variables.decision : null}
                errorKind={decision.error ? companionLinkErrorKind(decision.error) : null}
                onDecide={flow.decide}
                onRestart={flow.restart}
            />
        );
    }
    const error = flow.localError ?? (preview.error ? LINK_ERROR_COPY[companionLinkErrorKind(preview.error)] : undefined);
    return <LinkEntryCard code={flow.code} error={error} loading={preview.isPending} onCodeChange={flow.changeCode} onSubmit={flow.submit} />;
}

/** The `/link` page. */
export function CompanionLinkPage(): JSX.Element {
    return (
        <div className="mx-auto w-full max-w-lg px-4 py-8">
            <LinkStep />
        </div>
    );
}
