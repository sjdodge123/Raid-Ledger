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
 *
 * Stored JSON is UNTRUSTED: it can be hand-edited, or left behind by an
 * older build whose shape has since drifted. Always pass `validate` when the
 * consumer would break on an unexpected shape — a restored value that fails
 * validation is discarded AND evicted, so a bad blob can't wedge the feature
 * for the rest of the tab session.
 */
import { useCallback, useState } from 'react';

/**
 * Narrow untrusted parsed JSON to `T`, or return null to reject it.
 * Prefer allow-list style: copy known keys with checked types, drop the rest.
 */
export type SessionStateValidator<T> = (raw: unknown) => T | null;

function removeStored(key: string): void {
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // Blocked storage — nothing to evict, nothing to do.
    }
}

interface LoadResult<T> {
    value: T;
    /** True only when a stored value survived validation. */
    restored: boolean;
}

/** Read + validate in one pass so `restored` can't disagree with `value`. */
function loadStored<T>(
    key: string | null,
    initial: T,
    validate?: SessionStateValidator<T>,
): LoadResult<T> {
    if (!key || typeof window === 'undefined') {
        return { value: initial, restored: false };
    }
    try {
        const raw = window.sessionStorage.getItem(key);
        if (raw == null) return { value: initial, restored: false };
        const parsed: unknown = JSON.parse(raw);
        if (!validate) return { value: parsed as T, restored: true };
        const validated = validate(parsed);
        if (validated == null) {
            // Shape drift or tampering — evict so we don't re-read it on
            // every mount for the rest of the session.
            removeStored(key);
            return { value: initial, restored: false };
        }
        return { value: validated, restored: true };
    } catch {
        // Unparseable payload, or sessionStorage blocked (private mode).
        // Evicting is best-effort and itself guarded.
        removeStored(key);
        return { value: initial, restored: false };
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
    validate?: SessionStateValidator<T>,
): SessionStateResult<T> {
    const [state, setState] = useState(() => loadStored(key, initial, validate));

    // Adjust-state-during-render (React docs pattern) rather than a sync
    // effect: when the key changes we must swap to that key's stored value
    // before paint, and an effect here would trigger a cascading render.
    const [lastKey, setLastKey] = useState(key);
    if (key !== lastKey) {
        setLastKey(key);
        setState(loadStored(key, initial, validate));
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
