/**
 * Pulse-skeleton placeholders for the dynamic-categories review panel.
 * Shown during a regenerate round-trip; matches LineupBannerSkeleton style
 * (animate-pulse + bg-zinc-700/50 bars inside bg-panel/border-edge).
 */
import type { JSX } from 'react';

/** Pulse skeleton for a single card — matches LineupBannerSkeleton style. */
function DynamicCategoryCardSkeleton(): JSX.Element {
    return (
        <div className="rounded-xl bg-panel border border-edge/50 p-4 animate-pulse space-y-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex-1 space-y-2">
                    <div className="h-4 bg-zinc-700/50 rounded w-1/3" />
                    <div className="h-3 bg-zinc-700/50 rounded w-2/3" />
                </div>
                <div className="h-3 bg-zinc-700/50 rounded w-16" />
            </div>
            <div className="h-16 bg-zinc-700/30 rounded-md" />
            <div className="flex gap-2 overflow-hidden">
                {Array.from({ length: 6 }, (_, i) => (
                    <div
                        key={i}
                        className="w-16 h-20 bg-zinc-700/50 rounded flex-shrink-0"
                    />
                ))}
            </div>
            <div className="flex gap-2">
                <div className="h-7 bg-zinc-700/50 rounded w-20" />
                <div className="h-7 bg-zinc-700/50 rounded w-20" />
                <div className="h-7 bg-zinc-700/50 rounded w-16" />
            </div>
        </div>
    );
}

export function SkeletonList({ count }: { count: number }): JSX.Element {
    return (
        <div className="space-y-3">
            {Array.from({ length: count }, (_, i) => (
                <DynamicCategoryCardSkeleton key={i} />
            ))}
        </div>
    );
}
