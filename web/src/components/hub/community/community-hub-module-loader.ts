/**
 * ROK-1870 — lazy loader for the core `game_community` hub module. The module
 * (hero pills, member cells/actions, settings sections) only matters on a
 * community hub, so it ships as its own chunk instead of riding in the hub
 * page bundle; `useHubModule` resolves it through here.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { HubModule } from '../../../plugins/hub-module';
import { claimChunkReload, isChunkLoadError } from '../../../lib/chunk-error';

/** The hub kind this core module owns (no plugin registers it). */
export const COMMUNITY_HUB_KIND = 'game_community';

let loaded: HubModule | undefined;
let failure: Error | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

function notifyAll(): void {
    listeners.forEach((notify) => notify());
}

/**
 * Codex r3: a stale deploy chunk reloads the page once (the `lazyWithRetry`
 * idiom — the skeleton stays up meanwhile); any other failure is surfaced so
 * the page can swap its skeleton for an error with a retry.
 */
function onLoadFailed(error: unknown): void {
    pending = undefined;
    if (isChunkLoadError(error) && claimChunkReload()) {
        window.location.reload();
        return;
    }
    failure = error instanceof Error ? error : new Error('The community hub module failed to load');
    notifyAll();
}

/** Starts (once) the chunk load; a failed load clears itself so a retry can start another. */
export function loadCommunityHubModule(): Promise<void> {
    pending ??= import('./community-hub-module')
        .then((m) => {
            loaded = m.communityHubModule;
            failure = undefined;
            notifyAll();
        })
        .catch(onLoadFailed);
    return pending;
}

/** Clears a surfaced failure and loads the chunk again (the error state's Retry). */
export function retryCommunityHubModule(): void {
    failure = undefined;
    notifyAll();
    void loadCommunityHubModule();
}

function subscribe(notify: () => void): () => void {
    listeners.add(notify);
    return () => listeners.delete(notify);
}

const snapshot = (): HubModule | undefined => loaded;
const failureSnapshot = (): Error | undefined => failure;

/** The community module once its chunk has loaded; `undefined` while loading or when not `wanted`. */
export function useCommunityHubModule(wanted: boolean): HubModule | undefined {
    const mod = useSyncExternalStore(subscribe, snapshot);
    useEffect(() => {
        if (wanted && !loaded) void loadCommunityHubModule();
    }, [wanted]);
    return wanted ? mod : undefined;
}

/** The last load failure (until a retry); `undefined` when none or not `wanted`. */
export function useCommunityHubModuleError(wanted: boolean): Error | undefined {
    const error = useSyncExternalStore(subscribe, failureSnapshot);
    return wanted ? error : undefined;
}
