/**
 * The phone drawer's week ⇄ away swap (ROK-1585 drawer A).
 *
 * Tapping "I'm away" flips the drawer to the away view and asks the enclosing
 * sheet for a "‹ I'm away" title row whose back returns to the week. The
 * override is handed back on back AND on unmount (the drawer closed mid-swap),
 * so the next open starts on the week. Outside a sheet the header call is a
 * no-op and only the view flips.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameTimeAbsence } from '@raid-ledger/contract';
import { useSheetHeader } from '../../../../pages/scheduling/sheet-header-context';
import { useGameTimeAbsences } from '../../../../hooks/use-game-time';
import { nextAwayLabel } from '../away/away-panel.helpers';
import { awayDaysOfWeek } from './away-days';

const NO_ABSENCES: GameTimeAbsence[] = [];

/** Which view the drawer shows, and the tap that swaps to the away one. */
export function useAwayView(): { away: boolean; openAway: () => void } {
    const [away, setAway] = useState(false);
    const setHeader = useSheetHeader();
    const back = useCallback(() => {
        setAway(false);
        setHeader(null);
    }, [setHeader]);
    const openAway = useCallback(() => {
        setAway(true);
        setHeader({ title: "I'm away", onBack: back, backLabel: 'Back to my week', backTestId: 'away-back' });
    }, [back, setHeader]);
    useEffect(() => () => setHeader(null), [setHeader]);
    return { away, openAway };
}

/** The strip's away days (next seven days) and the entry row's "next" line. */
export function useAwaySummary(): { awayDays: Set<number>; nextLabel: string | null } {
    const today = useMemo(() => new Date(), []);
    const { data } = useGameTimeAbsences();
    const absences = data ?? NO_ABSENCES;
    return useMemo(() => ({
        awayDays: awayDaysOfWeek(absences, today),
        nextLabel: nextAwayLabel(absences, today),
    }), [absences, today]);
}
