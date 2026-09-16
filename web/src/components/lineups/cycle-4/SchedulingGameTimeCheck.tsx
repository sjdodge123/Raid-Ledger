/**
 * The game-time check, mounted inside the scheduling composite (ROK-1574).
 *
 * The check used to be ONE page-level overlay for every viewport. Below 768px
 * it is now a full-height sheet that collapses onto the page's ballot
 * (ROK-1579), so the phone shell lives here, beside that ballot.
 *
 * Both shells mount from HERE (review MAJOR: a page-level desktop mount kept
 * showing the check on completed polls where the composite — and so the phone
 * sheet — never renders). Above 768px this renders the desktop `Modal`
 * (`GameTimeRefreshModal`); below it the one-question sheet. One gate, one
 * mount.
 *
 * `sheetVisible` keeps the page's ladder out of the background while the
 * full-height sheet covers it; the sheet collapses the moment the check is
 * answered and the ladder is there underneath.
 *
 * ROK-1569: the phone body is the week editor itself (`PhoneWeekCheckStep`,
 * the Option A comp) rather than the four-answer `GameTimeCheckBody` — which
 * stays as the DESKTOP modal's body.
 */
import { useState, type JSX } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useGameTimeCheckGate } from '../../../pages/scheduling/use-game-time-check-gate';
import { GameTimeCheckSheet } from '../../../pages/scheduling/GameTimeCheckSheet';
import { PhoneWeekCheckStep } from '../../features/game-time/phone/PhoneWeekCheckStep';
import { GameTimeRefreshModal } from '../../../pages/scheduling/GameTimeRefreshModal';

export interface SchedulingGameTimeCheckState {
    /** The shell to render (desktop modal or phone sheet), or null. */
    shell: JSX.Element | null;
    /** True while the phone sheet is on screen — hide the page ladder. */
    sheetVisible: boolean;
}

/** The game-time check for the composite — see file-level docstring. */
export function useSchedulingGameTimeCheck(): SchedulingGameTimeCheckState {
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
                onVisibleChange={setSheetVisible}
                body={
                    <PhoneWeekCheckStep
                        ageDays={gate.ageDays}
                        hasSlots={gate.hasSlots}
                        onSkip={gate.skip}
                    />
                }
            />
        ),
    };
}
