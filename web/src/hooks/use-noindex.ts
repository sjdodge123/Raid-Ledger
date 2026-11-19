/**
 * ROK-1813 (D9) — keep a signed-out share page out of search engines. Adds
 * `<meta name="robots" content="noindex, nofollow">` while the page is
 * mounted and removes exactly that tag on unmount, so the rest of the app
 * stays indexable after the visitor navigates on.
 */
import { useEffect } from 'react';

export const NOINDEX_CONTENT = 'noindex, nofollow';

/** Mount-scoped robots meta. Safe to use on several pages; each removes only its own tag. */
export function useNoIndex(): void {
    useEffect(() => {
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = NOINDEX_CONTENT;
        document.head.appendChild(meta);
        return () => meta.remove();
    }, []);
}
