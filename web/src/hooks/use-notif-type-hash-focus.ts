/**
 * `/profile/notifications#notif-<type>` (ROK-1797): the Discord DM's "Adjust
 * notifications" button lands on one type's row. Once the rows have rendered
 * (they sit behind a skeleton, so a scroll-on-mount would miss them) scroll
 * the row into view and focus it — the row's own focus ring is the highlight.
 * An anchor with no matching row does nothing.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const NOTIF_TYPE_HASH = /^#notif-[a-z_]+$/;

export function useNotifTypeHashFocus(ready: boolean): void {
    const { hash } = useLocation();
    useEffect(() => {
        if (!ready || !NOTIF_TYPE_HASH.test(hash)) return;
        const row = document.getElementById(hash.slice(1));
        if (!row) return;
        row.scrollIntoView({ block: 'center' });
        row.focus({ preventScroll: true });
    }, [ready, hash]);
}
