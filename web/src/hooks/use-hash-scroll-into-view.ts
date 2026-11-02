/**
 * Scroll an anchored section into view when the URL hash names it (ROK-1955:
 * the `/link` "Manage devices" link lands on `#companion-devices`). React
 * Router does not scroll to a hash, and the section's content sits behind a
 * query, so this waits for `ready` — the same idiom as
 * `use-notif-type-hash-focus.ts`. `aliases` are extra hashes that land on the
 * same element (ROK-2056: `#companion` also opens the Companion card). A hash
 * naming another id does nothing.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const NO_ALIASES: readonly string[] = [];

/** Scroll `#id` into view once `ready` is true and the hash is `#id` or one of `#aliases`. */
export function useHashScrollIntoView(id: string, ready: boolean, aliases: readonly string[] = NO_ALIASES): void {
    const { hash } = useLocation();
    const matches = hash === `#${id}` || aliases.some((a) => hash === `#${a}`);
    useEffect(() => {
        if (!ready || !matches) return;
        document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }, [id, ready, matches]);
}
