/**
 * The game-time check, mounted inside the scheduling composite (ROK-1574).
 *
 * The check used to be ONE page-level overlay for every viewport. Below 768px
 * it is now a two-step sheet whose step 2 is the real vote ladder — and a
 * page-level shell has no access to the ladder's handlers, so the phone shell
 * lives here, beside the ballot, and takes the composite's own binding.
 *
 * Both shells mount from HERE (review MAJOR: a page-level desktop mount kept
 * showing the check on completed polls where the composite — and so the phone
 * sheet — never renders). Above 768px this renders the desktop `Modal`
 * (`GameTimeRefreshModal`); below it the two-step sheet. One gate, one mount.
 *
 * `sheetVisible` lets the composite hide its own ladder while the sheet's
 * step 2 shows the same ladder (review MAJOR: two copies in the DOM broke tab
 * order and the smoke specs' `.first()`).
 */
import { useState, type JSX } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useGameTimeCheckGate } from '../../../pages/scheduling/use-game-time-check-gate';
import { GameTimeCheckSheet } from '../../../pages/scheduling/GameTimeCheckSheet';
import { GameTimeCheckBody } from '../../../pages/scheduling/GameTimeCheckBody';
import { GameTimeRefreshModal } from '../../../pages/scheduling/GameTimeRefreshModal';
import type { SchedulingSlotListProps } from './SchedulingSlotList';

export interface SchedulingGameTimeCheckState {
    /** The shell to render (desktop modal or phone sheet), or null. */
    shell: JSX.Element | null;
    /** True while the phone sheet is on screen — hide the page ladder. */
    sheetVisible: boolean;
}

/** The game-time check for the composite — see file-level docstring. */
export function useSchedulingGameTimeCheck(
    ladder: SchedulingSlotListProps,
): SchedulingGameTimeCheckState {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const gate = useGameTimeCheckGate();
    const [sheetVisible, setSheetVisible] = useState(false);

    if (isDesktop) return { shell: <GameTimeRefreshModal />, sheetVisible: false };
    return {
        sheetVisible,
        shell: (
            <GameTimeCheckSheet
                isOpen={gate.open}
                onClose={gate.skip}
                ladder={ladder}
                onVisibleChange={setSheetVisible}
                stepOne={
                    <GameTimeCheckBody
                        ageDays={gate.ageDays}
                        hasSlots={gate.hasSlots}
                        surface="sheet"
                        onSkip={gate.skip}
                    />
                }
            />
        ),
    };
}
