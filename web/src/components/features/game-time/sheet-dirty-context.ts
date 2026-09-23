/**
 * ROK-1640: the game-time drawer's body tells the drawer whether it holds
 * unsaved edits, so closing (×, backdrop, swipe, Escape) can ask before it
 * throws them away. The drawer (`GameTimeCheckSheet`) owns the sources through
 * `useSheetDirtySources`; each part of the body — the week draft, the away
 * form — reports through `useReportSheetDirty`, and the drawer is dirty while
 * ANY of them is (one clean reporter never masks another). Outside a drawer the
 * default is a no-op.
 */
import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';

/** Report one source's dirty state, keyed by that source's id. */
export type ReportSheetDirty = (source: string, dirty: boolean) => void;

export const SheetDirtyContext = createContext<ReportSheetDirty>(() => {});

/** Report `dirty` to the enclosing drawer; reports clean again on unmount. */
export function useReportSheetDirty(dirty: boolean): void {
    const report = useContext(SheetDirtyContext);
    const source = useId();
    useEffect(() => { report(source, dirty); }, [report, source, dirty]);
    useEffect(() => () => report(source, false), [report, source]);
}

/** The drawer's side: the reporter to provide, and whether any source is dirty. */
export function useSheetDirtySources(): { dirty: boolean; report: ReportSheetDirty } {
    const [sources, setSources] = useState<ReadonlySet<string>>(() => new Set());
    const report = useCallback<ReportSheetDirty>((source, dirty) => {
        setSources((prev) => {
            if (prev.has(source) === dirty) return prev;
            const next = new Set(prev);
            if (dirty) next.add(source); else next.delete(source);
            return next;
        });
    }, []);
    return { dirty: sources.size > 0, report };
}
