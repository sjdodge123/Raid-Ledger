import type { JSX } from 'react';
/**
 * Skeleton loader for event detail page.
 */
export function EventDetailSkeleton(): JSX.Element {
    return (
        <div className="event-detail-skeleton">
            {/* Banner skeleton */}
            <div className="skeleton skeleton-banner" />

            {/* Slots skeleton */}
            <div className="skeleton skeleton-slots">
                <div className="skeleton skeleton-slots-header" />
                <div className="skeleton skeleton-slots-grid" />
            </div>

            {/* Roster skeleton */}
            <div className="skeleton skeleton-roster">
                <div className="skeleton skeleton-roster-header" />
                <div className="skeleton skeleton-roster-items" />
            </div>
        </div>
    );
}
