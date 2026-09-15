/**
 * The phone game-time check, mounted inside the scheduling composite (ROK-1574).
 *
 * The check used to be ONE page-level overlay for every viewport. Below 768px
 * it is now a two-step sheet whose step 2 is the real vote ladder — and a
 * page-level shell has no access to the ladder's handlers, so the phone shell
 * lives here, beside the ballot, and takes the composite's own binding.
 *
 * Above 768px this renders nothing: the desktop `Modal`
 * (`GameTimeRefreshModal`) still lives on the page. Both shells open on the
 * SAME `useGameTimeCheckGate()`, so they cannot drift.
 */
import type { JSX } from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { useGameTimeCheckGate } from '../../../pages/scheduling/use-game-time-check-gate';
import { GameTimeCheckSheet } from '../../../pages/scheduling/GameTimeCheckSheet';
import { GameTimeCheckBody } from '../../../pages/scheduling/GameTimeCheckBody';
import type { SchedulingSlotListProps } from './SchedulingSlotList';

/** Phone-only game-time check — see file-level docstring. */
export function SchedulingGameTimeCheck({ ladder }: {
    ladder: SchedulingSlotListProps;
}): JSX.Element | null {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const gate = useGameTimeCheckGate();
    if (isDesktop) return null;
    return (
        <GameTimeCheckSheet
            isOpen={gate.open}
            onClose={gate.skip}
            ladder={ladder}
            stepOne={
                <GameTimeCheckBody
                    ageDays={gate.ageDays}
                    hasSlots={gate.hasSlots}
                    surface="sheet"
                    onSkip={gate.skip}
                />
            }
        />
    );
}
