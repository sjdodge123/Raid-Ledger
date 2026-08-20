/**
 * sessionStorage-backed `useState` (ROK-1400).
 *
 * Generalises the inline pattern in `ActivityTimeline` so panel state can
 * survive intra-session navigation (open a game detail, come back) without
 * leaking across browser sessions the way localStorage would.
 *
 * Pass `key: null` to disable persistence entirely — useful while the id the
 * key derives from is still loading. When the key later changes, the stored
 * value for the NEW key is re-read, so state follows the entity rather than
 * bleeding between entities.
 */
import { useCallback, useState } from 'react';

/** Read a stored value, falling back on absent / corrupt / unavailable. */
function readStored<T>(key: string | null, fallback: T): T {
    if (!key || typeof window === 'undefined') return fallback;
    try {
        const raw = window.sessionStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw) as T;
    } catch {
        // Unparseable payload or sessionStorage blocked (private mode) —
        // degrade to the fallback rather than taking the panel down.
        return fallback;
    }
}

function writeStored<T>(key: string | null, value: T): void {
    if (!key || typeof window === 'undefined') return;
    try {
        window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Quota or private mode — persistence is a nicety, never a hard dep.
    }
}

export interface SessionStateResult<T> {
    value: T;
    setValue: (next: T) => void;
    /**
     * True when the current value came from storage rather than the initial
     * fallback. Lets callers suppress "first visit" behaviour (e.g. the
     * ROK-1255 auto-seed) that would otherwise clobber a restored choice.
     */
    restored: boolean;
}

/** `useState` whose value is mirrored into sessionStorage under `key`. */
export function useSessionState<T>(
    key: string | null,
    initial: T,
): SessionStateResult<T> {
    const [state, setState] = useState(() => ({
        value: readStored(key, initial),
        restored: hasStored(key),
    }));

    // Adjust-state-during-render (React docs pattern) rather than a sync
    // effect: when the key changes we must swap to that key's stored value
    // before paint, and an effect here would trigger a cascading render.
    const [lastKey, setLastKey] = useState(key);
    if (key !== lastKey) {
        setLastKey(key);
        setState({ value: readStored(key, initial), restored: hasStored(key) });
    }

    const setValue = useCallback(
        (next: T) => {
            setState({ value: next, restored: true });
            writeStored(key, next);
        },
        [key],
    );

    return { value: state.value, setValue, restored: state.restored };
}

/** Whether a value is actually present for this key. */
function hasStored(key: string | null): boolean {
    if (!key || typeof window === 'undefined') return false;
    try {
        return window.sessionStorage.getItem(key) != null;
    } catch {
        return false;
    }
}
