/**
 * ROK-1921/1922 (spec ROK-1905 §2.3) — the ONE "via LedgerLink · as of 3 days
 * ago" line under every WoW: Forever hub widget. Past 14 days it takes the
 * warning token. `null` freshness = no import yet: the source alone, no date.
 */
import type { JSX } from 'react';
import type { HubFactFreshness } from '@raid-ledger/contract';
import { syncedAgo } from '../../../lib/synced-ago';
import { isStale, sourceLabel } from './class-level.helpers';

interface FreshnessFooterProps {
    freshness: HubFactFreshness | null;
    /** Defaults to `forever-freshness`; a widget with its own spec hook passes one. */
    testId?: string;
}

/** Freshness line for one widget. */
export function FreshnessFooter({ freshness, testId = 'forever-freshness' }: FreshnessFooterProps): JSX.Element {
    const asOf = freshness?.asOf ?? null;
    const stale = isStale(asOf);
    const via = `via ${sourceLabel(freshness?.source ?? 'roster')}`;
    const when = asOf === null ? '' : ` · as of ${syncedAgo(asOf)}`;
    return (
        <p data-testid={testId} data-stale={stale ? 'true' : 'false'}
            className={`mt-3 text-xs ${stale ? 'text-warning' : 'text-dim'}`}>
            {via}{when}
        </p>
    );
}
