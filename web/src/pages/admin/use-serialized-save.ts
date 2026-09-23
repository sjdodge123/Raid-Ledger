/**
 * ROK-1435 (Codex P2): serialises full-replacement saves. At most one request
 * is in flight; edits made meanwhile merge into a single queued payload that is
 * sent once, after the in-flight request settles (success or error). An older
 * response can therefore never land after a newer one, and the cache ends on
 * the server's answer to the LAST request sent.
 *
 * `send` must never reject (the caller handles its own errors / toasts).
 */
import { useRef } from 'react';

export function useSerializedSave<T extends object>(send: (payload: T) => Promise<void>) {
    const latest = useRef<T | null>(null); // newest merged payload, sent or queued
    const lastSent = useRef<string | null>(null); // JSON of the payload last sent
    const inFlight = useRef<Promise<void> | null>(null);
    const queued = useRef<Promise<void> | null>(null);
    const settle = () => { latest.current = null; lastSent.current = null; };

    const dispatch = (): Promise<void> => {
        queued.current = null;
        const payload = latest.current;
        const json = JSON.stringify(payload);
        if (!payload || json === lastSent.current) { settle(); return Promise.resolve(); } // nothing new
        lastSent.current = json;
        const p = send(payload).finally(() => {
            if (inFlight.current === p) inFlight.current = null;
            if (latest.current === payload) settle(); // else a newer edit is queued behind us
        });
        inFlight.current = p;
        return p;
    };

    /** Merges `patch` onto the newest unsaved payload (or `base`) and saves it. */
    return (base: T, patch: Partial<T>): Promise<void> => {
        latest.current = { ...(latest.current ?? base), ...patch };
        if (queued.current) return queued.current; // the queued send picks up this edit
        if (!inFlight.current) return dispatch();
        queued.current = inFlight.current.then(dispatch, dispatch);
        return queued.current;
    };
}
