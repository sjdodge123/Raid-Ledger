import { useEffect, useRef, type RefObject } from 'react';

/** Closes an open popover menu on an outside mousedown or Escape; attach the ref to the trigger's wrapper. */
export function useMenuDismiss(open: boolean, close: () => void): RefObject<HTMLDivElement | null> {
    const rootRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onClick = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        document.addEventListener('mousedown', onClick);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
    }, [open, close]);
    return rootRef;
}
