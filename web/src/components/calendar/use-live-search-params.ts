import { useCallback, useLayoutEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Edits a copy of the live query string in place. */
export type SearchParamsMutator = (next: URLSearchParams) => void;

/**
 * `useSearchParams` with a writer that builds on the LIVE query string.
 *
 * react-router's functional `setSearchParams(prev => …)` hands `prev` the
 * render-time snapshot, so two writes before the next render (a mount effect
 * and a toolbar click) each start from the same old URL and the later one
 * drops the earlier one's change. This writer keeps the last written params
 * in a ref, so writes compose; it adopts a new snapshot whenever the location
 * itself changes (back/forward, a link), and skips writes that change nothing.
 * Writes use `replace` so URL sync never adds history entries.
 */
export function useLiveSearchParams(): [URLSearchParams, (mutate: SearchParamsMutator) => void] {
    const [searchParams, setSearchParams] = useSearchParams();
    const snapshotRef = useRef(searchParams);
    const liveRef = useRef(searchParams);

    useLayoutEffect(() => {
        if (snapshotRef.current === searchParams) return;
        snapshotRef.current = searchParams;
        liveRef.current = searchParams;
    }, [searchParams]);

    const write = useCallback((mutate: SearchParamsMutator): void => {
        const next = new URLSearchParams(liveRef.current);
        mutate(next);
        if (next.toString() === liveRef.current.toString()) return;
        liveRef.current = next;
        setSearchParams(next, { replace: true });
    }, [setSearchParams]);

    return [searchParams, write];
}
