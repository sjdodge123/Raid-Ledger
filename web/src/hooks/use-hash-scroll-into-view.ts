/**
 * Scroll an anchored section into view when the URL hash names it (ROK-1955:
 * the `/link` "Manage devices" link lands on `#companion-devices`). React
 * Router does not scroll to a hash, and the section's content sits behind a
 * query, so this waits for `ready` — the same idiom as
 * `use-notif-type-hash-focus.ts`. A hash naming another id does nothing.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Scroll `#id` into view once `ready` is true and the hash is `#id`. */
export function useHashScrollIntoView(id: string, ready: boolean): void {
    const { hash } = useLocation();
    useEffect(() => {
        if (!ready || hash !== `#${id}`) return;
        document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }, [id, ready, hash]);
}
