/**
 * ROK-1661 diagnostic flag for the DEMO_MODE viewport readout. `?vpdebug=1`
 * turns it on AND remembers it, so a tab opened later (plan 2026-09-23-2034-11b7
 * frame D was a new tab with a bare URL) still shows it; `?vpdebug=0` forgets it.
 * Storage can throw (private mode, blocked site data); the URL still works then.
 */
const STORAGE_KEY = 'rl.vpdebug';

function withStorage<T>(fn: (storage: Storage) => T): T | undefined {
    try {
        return fn(window.localStorage);
    } catch {
        return undefined;
    }
}

/** Whether the readout is on for this URL search string, updating the remembered flag. */
export function resolveVpDebug(search: string): boolean {
    const param = new URLSearchParams(search).get('vpdebug');
    if (param === '1') {
        withStorage((s) => s.setItem(STORAGE_KEY, '1'));
        return true;
    }
    if (param === '0') {
        withStorage((s) => s.removeItem(STORAGE_KEY));
        return false;
    }
    return withStorage((s) => s.getItem(STORAGE_KEY) === '1') ?? false;
}
