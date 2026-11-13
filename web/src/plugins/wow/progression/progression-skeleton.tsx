/**
 * ROK-1789 Part B — the Progression tab's loading placeholder. Its own eager
 * file so `hub/wow-tabs.tsx` can use it as the lazy chunk's Suspense fallback
 * and `progression-tab.tsx` while the query is pending.
 */
import type { JSX } from 'react';

/** The tab's loading placeholder (Suspense fallback + pending query). */
export function ProgressionSkeleton(): JSX.Element {
    return <div aria-busy="true" data-testid="progression-loading" className="h-64 animate-pulse rounded-lg border border-edge bg-panel" />;
}
