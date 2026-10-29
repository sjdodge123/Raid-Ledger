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
/** ROK-1859: a base key is its smallest chest's 22-char public key. */
const BASE_RE = /^[A-Za-z0-9_-]{22}$/;

function param(hash: string, name: string, re: RegExp): string | null {
    const m = /^#?materials\?(.*)$/.exec(hash);
    if (!m) return null;
    const value = new URLSearchParams(m[1] ?? '').get(name);
    return value !== null && re.test(value) ? value : null;
}

/** `#materials?item=Wood` → `Wood`; no item, a malformed one or another tab → null. */
export const materialsItemFromHash = (hash: string): string | null =>
    param(hash, 'item', PREFAB_RE);

/** ROK-1859: `#materials?base=<key>` → the key; none or malformed → null (All bases). */
export const materialsBaseFromHash = (hash: string): string | null =>
    param(hash, 'base', BASE_RE);

/** `#materials?item=<prefab>&base=<key>`; either may be null; `#materials` for neither. */
export function materialsHash(
    item: string | null,
    base: string | null = null,
): string {
    const q = new URLSearchParams();
    if (item !== null) q.set('item', item);
    if (base !== null) q.set('base', base);
    const s = q.toString();
    return s === '' ? '#materials' : `#materials?${s}`;
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
const readBase = (): string | null =>
    materialsBaseFromHash(window.location.hash);
const serverNull = (): string | null => null;

/** Rewrites one param of the current hash, keeping the other. */
function writeHash(next: { item?: string | null; base?: string | null }): void {
    const { pathname, search, hash } = window.location;
    const item = next.item === undefined ? materialsItemFromHash(hash) : next.item;
    const base = next.base === undefined ? materialsBaseFromHash(hash) : next.base;
    const url = `${pathname}${search}${materialsHash(item, base)}`;
    window.history.replaceState(window.history.state, '', url);
    listeners.forEach((l) => l());
}

/** The open item and its setter, both backed by the `#materials` hash. */
export function useMaterialsItem(): [
    string | null,
    (item: string | null) => void,
] {
    const item = useSyncExternalStore(subscribe, readItem, serverNull);
    const setItem = useCallback(
        (next: string | null) => writeHash({ item: next }),
        [],
    );
    return [item, setItem];
}

/** ROK-1859: the Base filter and its setter, kept beside the item in the hash. */
export function useMaterialsBase(): [
    string | null,
    (base: string | null) => void,
] {
    const base = useSyncExternalStore(subscribe, readBase, serverNull);
    const setBase = useCallback(
        (next: string | null) => writeHash({ base: next }),
        [],
    );
    return [base, setBase];
}
