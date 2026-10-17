/**
 * Skeleton placeholder for the LineupBanner while loading (ROK-935).
 */
import type { JSX } from 'react';

/** Pulse animation skeleton matching the banner shape. */
export function LineupBannerSkeleton(): JSX.Element {
    return (
        <div className="rounded-xl bg-panel border border-edge/50 p-6 mb-8 animate-pulse">
            <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full bg-zinc-700" />
                <div className="h-3 bg-zinc-700/50 rounded w-32" />
            </div>
            <div className="h-6 bg-zinc-700/50 rounded w-64 mb-2" />
            <div className="h-4 bg-zinc-700/50 rounded w-48 mb-4" />
            <div className="flex gap-3 overflow-hidden">
                {Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="w-16 h-20 bg-zinc-700/50 rounded-lg flex-shrink-0" />
                ))}
            </div>
        </div>
    );
}
