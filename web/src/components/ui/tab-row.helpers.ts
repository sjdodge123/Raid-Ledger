/**
 * TabRow's hash state (ROK-1785). Kept out of `tab-row.tsx` so that file
 * exports only components (react-refresh/only-export-components).
 *
 * In-page jump links ("See roster") must be plain `<a href="#roster">` or call
 * `selectTab` — a react-router `<Link to="#roster">` uses pushState, which
 * fires neither `hashchange` nor `popstate`, so the hook would not see it.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/** Stable identity so the alias effect does not re-run every render. */
const EMPTY_ALIASES: Readonly<Record<string, string>> = {};

/** The id a consumer gives the panel of tab `id`: `<prefix>-tab-<id>`. */
export function tabPanelId(prefix: string, id: string): string {
    return `${prefix}-tab-${id}`;
}

/**
 * `#members` → `members` when it is one of `ids`; anything else → `defaultId`.
 *
 * `aliases` maps a retired hash onto its current tab id, so a link shared
 * before a tab was renamed still lands on it (ROK-1830: `#roster` → Members).
 */
export function tabFromHash(
    hash: string,
    ids: readonly string[],
    defaultId: string,
    aliases: Readonly<Record<string, string>> = {},
): string {
    const raw = hash.replace(/^#/, '');
    const id = aliases[raw] ?? raw;
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
export function useHashTab(
    ids: readonly string[],
    defaultId: string,
    aliases: Readonly<Record<string, string>> = EMPTY_ALIASES,
): [string, (id: string) => void] {
    const hash = useSyncExternalStore(subscribeToHash, readHash, serverHash);
    const active = tabFromHash(hash, ids, defaultId, aliases);
    // A retired hash is rewritten in place, so the address bar and any copy of
    // the link settle on the current id without adding a history entry.
    useEffect(() => {
        const raw = window.location.hash.replace(/^#/, '');
        if (raw && aliases[raw] && aliases[raw] !== raw) {
            window.history.replaceState(null, '', `#${aliases[raw]}`);
        }
    }, [hash, aliases]);
    const selectTab = useCallback((id: string) => {
        window.location.hash = id;
    }, []);
    return [active, selectTab];
}
