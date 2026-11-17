/**
 * ROK-2226 — lazy wrapper for the event page's Discussion card / panel. The
 * forum message, composer and reply views ride in their own chunk, fetched only
 * for a signed-in viewer on a hub-tagged event (the section renders nothing
 * otherwise), so `event-detail-page` stays inside its bundle budget.
 */
import { lazy, Suspense, type JSX } from 'react';
import { claimChunkReload, isChunkLoadError } from '../../lib/chunk-error';
import type { EventDiscussionSectionProps } from './EventDiscussionPanel';

const LazyEventDiscussionSection = lazy(() =>
    import('./EventDiscussionPanel')
        .then((m) => ({ default: m.EventDiscussionSection }))
        .catch((error: unknown) => {
            if (isChunkLoadError(error) && claimChunkReload()) {
                window.location.reload();
                return new Promise<never>(() => {});
            }
            throw error;
        }),
);

/** `EventDiscussionSection`, loaded on demand; nothing (and no fetch) when signed out or untagged. */
export function EventDiscussionSectionLazy(
    props: EventDiscussionSectionProps,
): JSX.Element | null {
    const { event, enabled } = props;
    if (!enabled || event.guildId == null || event.hub == null) return null;
    return (
        <Suspense fallback={null}>
            <LazyEventDiscussionSection {...props} />
        </Suspense>
    );
}
