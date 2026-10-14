/**
 * TabRow's hash state (ROK-1785). Kept out of `tab-row.tsx` so that file
 * exports only components (react-refresh/only-export-components).
 *
 * In-page jump links ("See roster") must be plain `<a href="#roster">` or call
 * `selectTab` — a react-router `<Link to="#roster">` uses pushState, which
 * fires neither `hashchange` nor `popstate`, so the hook would not see it.
 */
import { useCallback, useSyncExternalStore } from 'react';

/** The id a consumer gives the panel of tab `id`: `<prefix>-tab-<id>`. */
export function tabPanelId(prefix: string, id: string): string {
    return `${prefix}-tab-${id}`;
}

/** `#roster` → `roster` when it is one of `ids`; anything else → `defaultId`. */
export function tabFromHash(hash: string, ids: readonly string[], defaultId: string): string {
    const id = hash.replace(/^#/, '');
    return ids.includes(id) ? id : defaultId;
}

function subscribeToHash(onChange: () => void): () => void {
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
        window.removeEventListener('hashchange', onChange);
        window.removeEventListener('popstate', onChange);
    };
}

const readHash = (): string => window.location.hash;
const serverHash = (): string => '';

/**
 * The active tab, read from `location.hash` and kept in sync with
 * `hashchange` / `popstate`. Returns `[activeId, selectTab]`; `selectTab`
 * writes the hash (a history entry, like clicking the tab).
 */
export function useHashTab(ids: readonly string[], defaultId: string): [string, (id: string) => void] {
    const hash = useSyncExternalStore(subscribeToHash, readHash, serverHash);
    const selectTab = useCallback((id: string) => {
        window.location.hash = id;
    }, []);
    return [tabFromHash(hash, ids, defaultId), selectTab];
}
