/**
 * ROK-1922 — the Forever widget footer: "via LedgerLink · as of 3 days ago",
 * in the warning tone once the data is older than 14 days (plan §2.3).
 */
import type { JSX } from 'react';
import type { HubFactFreshness } from '@raid-ledger/contract';
import { freshnessLine } from './roles.helpers';

/** Renders nothing when the server has no freshness for this fact. */
export function FactFreshnessFooter({ freshness, testId }: { freshness: HubFactFreshness | null; testId: string }): JSX.Element | null {
    if (freshness === null) return null;
    const { text, stale } = freshnessLine(freshness);
    return <p data-testid={testId} className={`mt-3 text-xs ${stale ? 'text-warning' : 'text-dim'}`}>{text}</p>;
}
