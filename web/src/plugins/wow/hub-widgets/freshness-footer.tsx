/**
 * ROK-1921 (spec ROK-1905 §2.3) — the "via LedgerLink · as of 3 days ago" line
 * under every WoW: Forever hub widget. Past 14 days it takes the warning token.
 */
import type { JSX } from 'react';
import { formatDistanceToNow } from 'date-fns';
import type { HubFactFreshness } from '@raid-ledger/contract';
import { isStale, sourceLabel } from './class-level.helpers';

/** Freshness line for one widget; `null` freshness = no import yet. */
export function FreshnessFooter({ freshness }: { freshness: HubFactFreshness | null }): JSX.Element {
    const asOf = freshness?.asOf ?? null;
    const stale = isStale(asOf);
    const via = `via ${sourceLabel(freshness?.source ?? 'roster')}`;
    const when = asOf === null ? '' : ` · as of ${formatDistanceToNow(new Date(asOf), { addSuffix: true })}`;
    return (
        <p data-testid="forever-freshness" data-stale={stale ? 'true' : 'false'}
            className={`mt-3 text-xs ${stale ? 'text-warning' : 'text-dim'}`}>
            {via}{when}
        </p>
    );
}
