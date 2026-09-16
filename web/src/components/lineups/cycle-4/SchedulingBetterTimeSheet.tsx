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

/**
 * ROK-1580: a DEFINITE height for the phone body, the same recipe as
 * `GameTimeCheckSheet`'s `CONTENT_BOX` — the group module stretches its hour
 * rows to fill it and never scrolls inside, because a `max-height` alone
 * leaves the rows their intrinsic 44px and the day ends mid-sheet.
 *
 * The two children arrive from the composite, so the layout is expressed with
 * child selectors rather than wrappers: the module (first) takes the slack,
 * the suggest form (last) keeps its intrinsic height at the bottom — the
 * frame's footer row.
 */
const PHONE_BODY =
    'flex h-[calc(95dvh-200px)] min-h-0 flex-col gap-3 ' +
    '[&>*:first-child]:min-h-0 [&>*:first-child]:flex-1 [&>*:last-child]:flex-none';

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
            className={isDesktop ? 'space-y-3' : PHONE_BODY}
        >
            {/* Desktop only (ROK-1580): on a phone the sheet has no room for a
                paragraph, and the module's legend carries the same meaning. */}
            {isDesktop && (
                <p className="text-xs text-secondary">
                    Group availability for this week. Tap a slot to propose it —
                    proposing counts as your vote.
                </p>
            )}
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
            maxHeight="95vh"
            initiallyExpanded
        >
            {body}
        </BottomSheet>
    );
}

/**
 * The button that opens {@link SchedulingBetterTimeSheet}.
 *
 * ROK-1546 (AC6): below `sm` this is the slot ladder's SECOND action, so it
 * uses the same secondary-button recipe as the row-level CTAs in
 * `SchedulingSlotRow` — a solid `border-edge-strong` outline on `bg-surface`
 * with `text-foreground`. The original dashed/muted "ghost" treatment read as
 * disabled chrome on a phone; it is kept from `sm` up, where the wider row and
 * the hover affordance carry it. Colours come from tokens only (fifteen themes
 * remap them), and `text-foreground` on `bg-surface` clears 4.5:1 in both
 * default families.
 */
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
            className="min-h-[44px] sm:min-h-[36px] w-full inline-flex items-center justify-center gap-2 rounded-lg border border-edge-strong bg-surface px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-emerald-500/60 sm:border-dashed sm:border-edge sm:bg-transparent sm:font-normal sm:text-secondary sm:hover:text-foreground"
        >
            <span aria-hidden="true">+</span>
            None of these work — find a better time
        </button>
    );
}
