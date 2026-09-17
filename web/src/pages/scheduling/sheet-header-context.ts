/**
 * The header seam for `GameTimeCheckSheet` (ROK-1585 drawer A).
 *
 * The phone week editor swaps the drawer to its "I'm away" view; that view
 * needs the drawer's title row to read "‹ I'm away" with a way back. Like
 * `StepOneDoneContext`, a context keeps the body a plain `ReactNode`: the body
 * sets an override, the sheet draws it, `null` restores the default title.
 */
import { createContext, useContext } from 'react';

/** What a body may put in the sheet's title row. */
export interface SheetHeaderOverride {
    title: string;
    onBack: () => void;
    /** Accessible name of the back button (default "Back"). */
    backLabel?: string;
    /** `data-testid` of the back button (default `sheet-back`). */
    backTestId?: string;
}

/** Set (or with `null`, clear) the sheet's title-row override. */
export type SetSheetHeader = (header: SheetHeaderOverride | null) => void;

/** No-op outside the sheet — the same body also renders on pages and in modals. */
export const SheetHeaderContext = createContext<SetSheetHeader>(() => {});

/** Returns the setter for the enclosing sheet's title row (a no-op elsewhere). */
export function useSheetHeader(): SetSheetHeader {
    return useContext(SheetHeaderContext);
}
