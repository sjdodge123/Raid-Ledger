/**
 * ROK-1640: the game-time drawer's body tells the drawer whether it holds
 * unsaved edits, so closing (×, backdrop, swipe, Escape) can ask before it
 * throws them away. The drawer (`GameTimeCheckSheet`) provides the setter; the
 * week editor reports its draft through `useReportSheetDirty`. Outside a
 * drawer the default is a no-op.
 */
import { createContext, useContext, useEffect } from 'react';

export const SheetDirtyContext = createContext<(dirty: boolean) => void>(() => {});

/** Report `dirty` to the enclosing drawer; reports clean again on unmount. */
export function useReportSheetDirty(dirty: boolean): void {
    const report = useContext(SheetDirtyContext);
    useEffect(() => { report(dirty); }, [report, dirty]);
    useEffect(() => () => report(false), [report]);
}
