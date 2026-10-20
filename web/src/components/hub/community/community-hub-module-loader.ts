/**
 * ROK-1870 — lazy loader for the core `game_community` hub module. The module
 * (hero pills, member cells/actions, settings sections) only matters on a
 * community hub, so it ships as its own chunk instead of riding in the hub
 * page bundle; `useHubModule` resolves it through here.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { HubModule } from '../../../plugins/hub-module';

/** The hub kind this core module owns (no plugin registers it). */
export const COMMUNITY_HUB_KIND = 'game_community';

let loaded: HubModule | undefined;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Starts (once) the chunk load; a failed load clears itself so the next mount retries. */
export function loadCommunityHubModule(): Promise<void> {
    pending ??= import('./community-hub-module')
        .then((m) => {
            loaded = m.communityHubModule;
            listeners.forEach((notify) => notify());
        })
        .catch(() => {
            pending = undefined;
        });
    return pending;
}

function subscribe(notify: () => void): () => void {
    listeners.add(notify);
    return () => listeners.delete(notify);
}

const snapshot = (): HubModule | undefined => loaded;

/** The community module once its chunk has loaded; `undefined` while loading or when not `wanted`. */
export function useCommunityHubModule(wanted: boolean): HubModule | undefined {
    const mod = useSyncExternalStore(subscribe, snapshot);
    useEffect(() => {
        if (wanted && !loaded) void loadCommunityHubModule();
    }, [wanted]);
    return wanted ? mod : undefined;
}
