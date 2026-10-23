/**
 * ROK-1893 — lazy wrapper for the event page's hub join prompts. The event
 * page is eager (app entry), so the prompt cards + their API ride in their own
 * chunk, fetched only for a signed-in viewer.
 */
import { lazy, Suspense, type JSX } from 'react';
import { claimChunkReload, isChunkLoadError } from '../../../lib/chunk-error';
import type { HubJoinPrompts as HubJoinPromptsImpl } from './hub-join-prompt';

type Props = Parameters<typeof HubJoinPromptsImpl>[0];

const LazyHubJoinPrompts = lazy(() =>
    import('./hub-join-prompt')
        .then((m) => ({ default: m.HubJoinPrompts }))
        .catch((error: unknown) => {
            if (isChunkLoadError(error) && claimChunkReload()) {
                window.location.reload();
                return new Promise<never>(() => {});
            }
            throw error;
        }),
);

/** `HubJoinPrompts`, loaded on demand; renders nothing (and loads nothing) when signed out. */
export function HubJoinPromptsLazy(props: Props): JSX.Element | null {
    if (!props.enabled) return null;
    return (
        <Suspense fallback={null}>
            <LazyHubJoinPrompts {...props} />
        </Suspense>
    );
}
