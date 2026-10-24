/**
 * ROK-1918 (Codex fix round) — every way out of arrange mode that would drop
 * an unsaved draft asks first, through the one `DiscardChangesConfirm`:
 * Cancel, and an in-hub tab switch (the hub's tabs are plain `<a href="#id">`
 * links — `TabRow`, its More menu, in-page jump links). A tab click while
 * dirty is held (`preventDefault`), and Discard exits then applies the hash.
 *
 * NOT guarded: a route change to another page (an in-app `<Link>`, Back to a
 * non-hub route) and Back/Forward between tabs. The app runs under
 * `BrowserRouter`, which has no navigation blocker (`useBlocker` needs a data
 * router; migrating is out of scope), and `popstate`/`hashchange` cannot be
 * cancelled. Reload, close and external links are covered by `beforeunload`
 * (`use-arrange-state`).
 */
import { useCallback, useEffect, useRef } from 'react';
import { useDirtyCloseGuard } from '../../../hooks/use-dirty-close-guard';

/** The same-page hash a plain left click on `target` would navigate to, if any. */
function hashLinkTarget(e: MouseEvent): string | null {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    const link = e.target instanceof Element ? e.target.closest('a[href^="#"]') : null;
    const href = link?.getAttribute('href') ?? null;
    return href !== null && href !== window.location.hash ? href : null;
}

/** While `dirty`, a same-page hash link click is held and handed to `onHold`. */
function useHashLinkHold(dirty: boolean, onHold: (hash: string) => void): void {
    useEffect(() => {
        if (!dirty) return undefined;
        const onClick = (e: MouseEvent): void => {
            const hash = hashLinkTarget(e);
            if (hash === null) return;
            e.preventDefault();
            onHold(hash);
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [dirty, onHold]);
}

export function useArrangeLeaveGuard(dirty: boolean, onExit: () => void) {
    const pending = useRef<string | null>(null);
    const leave = useCallback(() => {
        const hash = pending.current;
        pending.current = null;
        onExit();
        if (hash !== null) window.location.hash = hash;
    }, [onExit]);
    const guard = useDirtyCloseGuard(dirty, leave);
    const { requestClose, keep: settle } = guard;
    const hold = useCallback((hash: string) => { pending.current = hash; requestClose(); }, [requestClose]);
    useHashLinkHold(dirty, hold);
    const keep = useCallback(() => { pending.current = null; settle(); }, [settle]);
    return { requestClose, confirming: guard.confirming, keep, discard: guard.discard };
}
