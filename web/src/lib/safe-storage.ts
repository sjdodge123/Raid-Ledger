/**
 * localStorage access that never throws.
 *
 * Safari private mode, disabled site data and some embedded webviews make
 * `localStorage` (or its getters/setters) throw a `SecurityError`. Stores
 * read it while they are being created, so an unguarded read there blanks
 * the whole SPA. Reads fall back to `null`; writes and removals become no-ops.
 */
export function safeGetItem(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function safeSetItem(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Storage blocked or full — the preference lives for this session only.
    }
}

export function safeRemoveItem(key: string): void {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Storage blocked — nothing to remove.
    }
}
