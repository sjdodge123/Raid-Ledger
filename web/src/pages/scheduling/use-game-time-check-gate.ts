/**
 * The ONE gate for the game-time check (ROK-1574).
 *
 * The check has two shells — the desktop `Modal` (`GameTimeRefreshModal`) and
 * the phone two-step `BottomSheet` (`GameTimeCheckSheet`). BOTH mount from the
 * scheduling composite (`useSchedulingGameTimeCheck`) so step 2 can be the real
 * ballot and neither shell can show where the other does not. They must open on
 * exactly the same condition, so the condition lives here and neither shell
 * derives it again.
 *
 * Closing stays DERIVED, never forced: "Looks right" and a successful absence
 * save both stamp `game_time_confirmed_at` server-side, so the refetch returns
 * `gameTimeStale: false` and the check disappears on its own. A failed write
 * leaves staleness true → it stays open for retry.
 */
import { useState } from 'react';
import { useGameTime } from '../../hooks/use-game-time';
import { isWizardSkipped, setWizardSkipped } from './scheduling-wizard-utils';

export interface GameTimeCheckGate {
    /** Whether a shell should render the check at all. */
    open: boolean;
    /** Whole days since the last confirmation; `null` = never confirmed. */
    ageDays: number | null | undefined;
    /** Whether the viewer has any saved template slots (drives the null-age copy). */
    hasSlots: boolean;
    /** Answer 4 — session-skip + dismiss for the rest of the session. */
    skip: () => void;
}

/** Shared open/skip state for both game-time-check shells. */
export function useGameTimeCheckGate(): GameTimeCheckGate {
    const { data: gameTime } = useGameTime();
    const [dismissed, setDismissed] = useState(false);

    const stale = !!gameTime?.gameTimeStale && !isWizardSkipped();

    return {
        open: stale && !dismissed,
        ageDays: gameTime?.gameTimeAgeDays ?? null,
        // Template rows only: the composite also carries event-only rows
        // (`fromTemplate: false`), which are not a saved week (Codex, ROK-1569).
        hasSlots: (gameTime?.slots ?? []).some((s) => s.fromTemplate !== false),
        skip: (): void => {
            setWizardSkipped();
            setDismissed(true);
        },
    };
}
