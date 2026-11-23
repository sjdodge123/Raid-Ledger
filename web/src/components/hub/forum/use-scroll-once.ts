/** ROK-1175 / ROK-2274 — shared by `forum-message.tsx` and `forum-signup-line.tsx`. */
import { useEffect, useRef, type RefObject } from 'react';

/** The `?reply=<id>` target scrolls into view once it mounts (same as Posts' `post-item.tsx`). */
export function useScrollOnce(highlighted: boolean): RefObject<HTMLElement | null> {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        if (highlighted) ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, [highlighted]);
    return ref;
}
