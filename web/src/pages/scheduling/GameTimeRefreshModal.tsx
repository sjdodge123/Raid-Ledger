/**
 * Game Time check overlay (ROK-1301 → ROK-1564).
 *
 * Mounted on the scheduling poll page, it auto-opens iff `gameTimeStale === true`
 * AND the wizard isn't session-skipped. ROK-1564 replaced its body — the week
 * painter (`GameTimeGrid`) is GONE from the overlay; what's left is one question
 * ("Anything changed?") with four answers, all in `GameTimeCheckBody`. The week
 * editor lives at its own route and is reached by the "Edit my week" link.
 *
 * Shell follows the house viewport branch (design-system §4.4): `Modal` at
 * ≥768px, the SAME body in a `BottomSheet` below — copied from
 * `components/lineups/cycle-4/SchedulingBetterTimeSheet.tsx`.
 *
 * Closing is still DERIVED, never forced: "Looks right" and a successful
 * absence save both stamp `game_time_confirmed_at` server-side, so the
 * game-time refetch returns `gameTimeStale: false` and the overlay disappears
 * on its own. A failed write leaves staleness true → it stays open for retry.
 */
import { useState } from 'react';
import type { JSX } from 'react';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { useGameTime } from '../../hooks/use-game-time';
import { useMediaQuery } from '../../hooks/use-media-query';
import { isWizardSkipped, setWizardSkipped } from './scheduling-wizard-utils';
import { GameTimeCheckBody } from './GameTimeCheckBody';

/** One title for both shells — the question itself is the body's first line. */
const TITLE = 'Anything changed?';

/**
 * Viewport shell (design-system §4.4): `Modal` ≥768px, `BottomSheet` below.
 *
 * `BottomSheet` keeps its portal mounted while closed; this overlay only renders
 * while open anyway, and mounting it closed would leave a focusable Close button
 * in the poll page's tab order (ROK-1543 Codex review).
 */
function CheckShell({ isDesktop, onClose, children }: {
    isDesktop: boolean; onClose: () => void; children: JSX.Element;
}): JSX.Element {
    if (isDesktop) {
        return (
            <Modal isOpen onClose={onClose} title={TITLE} maxWidth="max-w-md" bodyClassName="p-4">
                {children}
            </Modal>
        );
    }
    return (
        <BottomSheet isOpen onClose={onClose} title={TITLE} maxHeight="80vh">
            {children}
        </BottomSheet>
    );
}

/**
 * Self-gating game-time check. The open state is DERIVED (`stale && !dismissed`),
 * so staleness arriving after mount still surfaces the overlay, while an explicit
 * Skip / close keeps it shut for the session.
 */
export function GameTimeRefreshModal(): JSX.Element | null {
    const { data: gameTime } = useGameTime();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [dismissed, setDismissed] = useState(false);

    const stale = !!gameTime?.gameTimeStale && !isWizardSkipped();
    const open = stale && !dismissed;

    if (!open) return null;

    const handleSkip = (): void => {
        setWizardSkipped();
        setDismissed(true);
    };

    return (
        <CheckShell isDesktop={isDesktop} onClose={handleSkip}>
            <GameTimeCheckBody
                ageDays={gameTime?.gameTimeAgeDays ?? null}
                surface={isDesktop ? 'modal' : 'sheet'}
                onSkip={handleSkip}
            />
        </CheckShell>
    );
}
