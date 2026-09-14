/**
 * "Find a better time" surface for the scheduling poll (ROK-1543 / P1-1 AC3).
 *
 * Layout B demotes the group-availability heatmap from the page's primary
 * body to ONE affordance: below 768px it opens as a `BottomSheet`, above as
 * a `Modal` — the same viewport branch `RescheduleModal` and `FilterPanel`
 * already use, so no new overlay primitive is introduced. The suggest form
 * travels with it: a heatmap cell click prefills that form, and the two must
 * never end up on opposite sides of a scrim.
 */
import type { JSX, ReactNode } from 'react';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';

const TITLE = 'Find a better time';

export interface SchedulingBetterTimeSheetProps {
    isOpen: boolean;
    onClose: () => void;
    children: ReactNode;
}

/** Heatmap + suggest-form overlay — see file-level docstring. */
export function SchedulingBetterTimeSheet(
    props: SchedulingBetterTimeSheetProps,
): JSX.Element | null {
    const { isOpen, onClose, children } = props;
    const isDesktop = useMediaQuery('(min-width: 768px)');
    // `BottomSheet` keeps its portal mounted while closed (so it can slide),
    // so the BODY is what gates on `isOpen` — otherwise the heatmap and the
    // suggest form would still be in the page's DOM behind the scrim.
    const body = !isOpen ? null : (
        <div
            data-testid="scheduling-better-time-body"
            data-surface={isDesktop ? 'modal' : 'sheet'}
            className="space-y-3"
        >
            <p className="text-xs text-secondary">
                Group availability for this week. Tap a slot to propose it —
                proposing counts as your vote.
            </p>
            {children}
        </div>
    );
    if (isDesktop) {
        return (
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={TITLE}
                maxWidth="max-w-3xl"
            >
                {body}
            </Modal>
        );
    }
    // Codex review (ROK-1543): `BottomSheet` renders its header + a focusable
    // Close button even while closed, which would sit in the tab order on every
    // poll page. Mount the sheet only while open (the slide-out is forfeited).
    if (!isOpen) return null;
    return (
        <BottomSheet
            isOpen={isOpen}
            onClose={onClose}
            title={TITLE}
            maxHeight="80vh"
        >
            {body}
        </BottomSheet>
    );
}

/** The button that opens {@link SchedulingBetterTimeSheet}. */
export function SchedulingBetterTimeTrigger({
    onClick,
}: {
    onClick: () => void;
}): JSX.Element {
    return (
        <button
            type="button"
            data-testid="scheduling-find-better-time"
            onClick={onClick}
            className="min-h-[44px] sm:min-h-[36px] w-full rounded-lg border border-dashed border-edge px-3 py-2 text-sm text-secondary transition-colors hover:border-emerald-500/60 hover:text-foreground"
        >
            + None of these work — find a better time
        </button>
    );
}
