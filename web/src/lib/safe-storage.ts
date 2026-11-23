/**
 * Web Storage access that never throws.
 *
 * Safari private mode, disabled site data and some embedded webviews make
 * `localStorage` / `sessionStorage` (or their getters/setters) throw a
 * `SecurityError`. Stores read it while they are being created, so an
 * unguarded read there blanks the whole SPA. Reads fall back to `null`
 * (blocked reads like "missing"); writes and removals become no-ops.
 */
type StorageArea = 'localStorage' | 'sessionStorage';

function readFrom(area: StorageArea, key: string): string | null {
    try {
        return window[area].getItem(key);
    } catch {
        return null;
    }
}

function writeTo(area: StorageArea, key: string, value: string): void {
    try {
        window[area].setItem(key, value);
    } catch {
        // Storage blocked or full — the value lives for this page only.
    }
}

function removeFrom(area: StorageArea, key: string): void {
    try {
        window[area].removeItem(key);
    } catch {
        // Storage blocked — nothing to remove.
    }
}

/** Read a localStorage value; `null` when missing or storage is blocked. */
export function safeGetItem(key: string): string | null {
    return readFrom('localStorage', key);
}

/** Write a localStorage value; a no-op when storage is blocked or full. */
export function safeSetItem(key: string, value: string): void {
    writeTo('localStorage', key, value);
}

/** Remove a localStorage value; a no-op when storage is blocked. */
export function safeRemoveItem(key: string): void {
    removeFrom('localStorage', key);
}

/** Read a sessionStorage value; `null` when missing or storage is blocked. */
export function safeSessionGetItem(key: string): string | null {
    return readFrom('sessionStorage', key);
}

/** Write a sessionStorage value; a no-op when storage is blocked or full. */
export function safeSessionSetItem(key: string, value: string): void {
    writeTo('sessionStorage', key, value);
}

/** Remove a sessionStorage value; a no-op when storage is blocked. */
export function safeSessionRemoveItem(key: string): void {
    removeFrom('sessionStorage', key);
}
