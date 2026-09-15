/**
 * Game Time check — DESKTOP shell (ROK-1301 → ROK-1564 → ROK-1574).
 *
 * Mounted on the scheduling poll page, it auto-opens iff the shared
 * `useGameTimeCheckGate()` says so. ROK-1564 replaced its body — the week
 * painter (`GameTimeGrid`) is GONE from the overlay; what's left is one
 * question with four answers, all in `GameTimeCheckBody`, each carrying a
 * one-line explainer (ROK-1574 AC5).
 *
 * ROK-1574 makes this shell desktop-only. Below 768px the check is the first
 * step of `GameTimeCheckSheet`, which lives INSIDE `SchedulingComposite` so
 * its step 2 can be the real vote ladder — a page-level shell has no access to
 * the ladder's handlers. Both shells open on the same gate hook, so they
 * cannot drift.
 *
 * Closing is still DERIVED, never forced — see `use-game-time-check-gate.ts`.
 */
import type { JSX } from 'react';
import { Modal } from '../../components/ui/modal';
import { useMediaQuery } from '../../hooks/use-media-query';
import { useGameTimeCheckGate } from './use-game-time-check-gate';
import { GameTimeCheckBody } from './GameTimeCheckBody';

/** ROK-1574: the title names the surface; the question is the body's first line. */
const TITLE = 'Game time check';

/** Self-gating desktop game-time check — see file-level docstring. */
export function GameTimeRefreshModal(): JSX.Element | null {
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const gate = useGameTimeCheckGate();

    if (!isDesktop || !gate.open) return null;

    return (
        <Modal isOpen onClose={gate.skip} title={TITLE} maxWidth="max-w-md" bodyClassName="p-4">
            <GameTimeCheckBody
                ageDays={gate.ageDays}
                hasSlots={gate.hasSlots}
                surface="modal"
                onSkip={gate.skip}
            />
        </Modal>
    );
}
