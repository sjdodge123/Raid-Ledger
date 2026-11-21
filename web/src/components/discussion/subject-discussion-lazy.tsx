/**
 * ROK-2272 S9 — lazy wrapper for the poll / lineup Discussion card. The reply
 * composer rides in its own chunk, fetched only for a signed-in viewer, so the
 * poll and lineup pages stay inside their bundle budgets.
 */
import { lazy, Suspense, type JSX } from 'react';
import { claimChunkReload, isChunkLoadError } from '../../lib/chunk-error';
import type { SubjectDiscussionCardProps } from './SubjectDiscussionCard';

const LazySubjectDiscussionCard = lazy(() =>
    import('./SubjectDiscussionCard')
        .then((m) => ({ default: m.SubjectDiscussionCard }))
        .catch((error: unknown) => {
            if (isChunkLoadError(error) && claimChunkReload()) {
                window.location.reload();
                return new Promise<never>(() => {});
            }
            throw error;
        }),
);

/** `SubjectDiscussionCard`, loaded on demand; nothing (and no fetch) when signed out. */
export function SubjectDiscussionCardLazy(props: SubjectDiscussionCardProps): JSX.Element | null {
    if (!props.enabled || props.subject.id <= 0) return null;
    return (
        <Suspense fallback={null}>
            <LazySubjectDiscussionCard {...props} />
        </Suspense>
    );
}
