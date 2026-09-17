/**
 * The phone drawer's week ⇄ away swap (ROK-1585 drawer A).
 *
 * Tapping "I'm away" flips the drawer to the away view and asks the enclosing
 * sheet for a "‹ I'm away" title row whose back returns to the week. The
 * override is handed back on back AND on unmount (the drawer closed mid-swap),
 * so the next open starts on the week. Outside a sheet the header call is a
 * no-op and only the view flips.
 *
 * Focus follows the swap (review): opening lands on the header's back button,
 * back returns to the "I'm away" entry row. The initial mount moves nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { GameTimeAbsence } from '@raid-ledger/contract';
import { useSheetHeader } from '../../../../pages/scheduling/sheet-header-context';
import { useGameTimeAbsences } from '../../../../hooks/use-game-time';
import { nextAwayLabel } from '../away/away-panel.helpers';
import { useToday } from '../away/use-today';
import { awayDaysOfWeek } from './away-days';

const NO_ABSENCES: GameTimeAbsence[] = [];
const BACK_TEST_ID = 'away-back';

/** What {@link useAwayView} hands the drawer body. */
export interface AwayViewState {
    away: boolean;
    openAway: () => void;
    /** Attach to the "I'm away" entry row — focus returns there on back. */
    entryRef: RefObject<HTMLButtonElement | null>;
}

/** After a swap (not on mount): focus the sheet's back button, or the entry row. */
function useSwapFocus(away: boolean, entryRef: RefObject<HTMLButtonElement | null>): () => void {
    const swapped = useRef(false);
    useEffect(() => {
        if (!swapped.current) return;
        if (!away) { entryRef.current?.focus(); return; }
        document.querySelector<HTMLElement>(`[data-testid="${BACK_TEST_ID}"]`)?.focus();
    }, [away, entryRef]);
    return useCallback(() => { swapped.current = true; }, []);
}

/** Which view the drawer shows, and the tap that swaps to the away one. */
export function useAwayView(): AwayViewState {
    const [away, setAway] = useState(false);
    const entryRef = useRef<HTMLButtonElement>(null);
    const markSwapped = useSwapFocus(away, entryRef);
    const setHeader = useSheetHeader();
    const back = useCallback(() => {
        setAway(false);
        setHeader(null);
    }, [setHeader]);
    const openAway = useCallback(() => {
        markSwapped();
        setAway(true);
        setHeader({ title: "I'm away", onBack: back, backLabel: 'Back to my week', backTestId: BACK_TEST_ID });
    }, [back, markSwapped, setHeader]);
    useEffect(() => () => setHeader(null), [setHeader]);
    return { away, openAway, entryRef };
}

/** The strip's away days (next seven days) and the entry row's "next" line. */
export function useAwaySummary(): { awayDays: Set<number>; nextLabel: string | null } {
    const today = useToday();
    const { data } = useGameTimeAbsences();
    const absences = data ?? NO_ABSENCES;
    return useMemo(() => ({
        awayDays: awayDaysOfWeek(absences, today),
        nextLabel: nextAwayLabel(absences, today),
    }), [absences, today]);
}
