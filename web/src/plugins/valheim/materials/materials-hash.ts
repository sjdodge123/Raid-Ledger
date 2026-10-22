/**
 * ROK-1889 — the Materials tab's open item lives in the hash
 * (`#materials?item=<prefab>`), so the "Chests holding <item>" panel is
 * shareable and Back from a chest's Map link lands on it again. Plain
 * `#materials` (and every other hash) means no item. Choosing an item
 * rewrites the current history entry instead of pushing one, so Back still
 * leaves the tab rather than stepping through each row click.
 */
import { useCallback, useSyncExternalStore } from 'react';

const PREFAB_RE = /^[A-Za-z0-9_]{1,64}$/;

/** `#materials?item=Wood` → `Wood`; no item, a malformed one or another tab → null. */
export function materialsItemFromHash(hash: string): string | null {
    const m = /^#?materials\?(.*)$/.exec(hash);
    if (!m) return null;
    const item = new URLSearchParams(m[1] ?? '').get('item');
    return item !== null && PREFAB_RE.test(item) ? item : null;
}

/** The Materials hash for `item`: `#materials?item=<prefab>`, or `#materials` for none. */
export function materialsHash(item: string | null): string {
    if (item === null) return '#materials';
    return `#materials?${new URLSearchParams({ item }).toString()}`;
}

/** `replaceState` fires no event, so writers tell readers themselves. */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
    listeners.add(onChange);
    window.addEventListener('hashchange', onChange);
    window.addEventListener('popstate', onChange);
    return () => {
        listeners.delete(onChange);
        window.removeEventListener('hashchange', onChange);
        window.removeEventListener('popstate', onChange);
    };
}

const readItem = (): string | null =>
    materialsItemFromHash(window.location.hash);
const serverItem = (): string | null => null;

/** The open item and its setter, both backed by the `#materials` hash. */
export function useMaterialsItem(): [
    string | null,
    (item: string | null) => void,
] {
    const item = useSyncExternalStore(subscribe, readItem, serverItem);
    const setItem = useCallback((next: string | null) => {
        const { pathname, search } = window.location;
        const url = `${pathname}${search}${materialsHash(next)}`;
        window.history.replaceState(window.history.state, '', url);
        listeners.forEach((l) => l());
    }, []);
    return [item, setItem];
}
