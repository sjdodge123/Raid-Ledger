/**
 * "Find a better time" surface for the scheduling poll (ROK-1543 / P1-1 AC3).
 *
 * Layout B demotes the group-availability heatmap from the page's primary
 * body to ONE affordance: below 768px it opens as a `BottomSheet`, above as
 * a `Modal` — the same viewport branch `RescheduleModal` and `FilterPanel`
 * already use, so no new overlay primitive is introduced. The suggest form
 * travels with it: a heatmap cell click prefills that form, and the two must
 * never end up on opposite sides of a scrim.
 *
 * ROK-1588: the desktop modal is `max-w-5xl` so the week-columns view gets
 * seven readable day columns (Q11).
 */
import type { JSX, ReactNode } from 'react';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { SheetTitleRow } from '../../../pages/scheduling/SheetTitleRow';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

const TITLE = 'Find a better time';

/**
 * ROK-1580: a DEFINITE height for the phone body, the same recipe as
 * `GameTimeCheckSheet`'s `CONTENT_BOX` — the group module stretches its hour
 * rows to fill it and never scrolls inside, because a `max-height` alone
 * leaves the rows their intrinsic 44px and the day ends mid-sheet.
 *
 * The 200px only holds with the SAME chrome as that sheet: `SheetTitleRow`
 * inside the content box, `ariaLabel` (not `title`) on `BottomSheet`. Measured
 * on the fleet at 393×851 (review MAJOR-2): with this header the content
 * overflows the sheet's scroller below ~165px of subtraction, so 200 keeps the
 * suggest-form footer on screen with room to spare.
 *
 * The two children arrive from the composite, so the layout is expressed with
 * child selectors rather than wrappers: the module (first) takes the slack,
 * the suggest form (last) keeps its intrinsic height at the bottom — the
 * frame's footer row.
 */
const PHONE_BODY =
    'flex h-[calc(var(--sheet-vh,1dvh)_*_95_-_200px)] min-h-0 flex-col gap-3 ' +
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
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    // `BottomSheet` keeps its portal mounted while closed (so it can slide),
    // so the BODY is what gates on `isOpen` — otherwise the heatmap and the
    // suggest form would still be in the page's DOM behind the scrim.
    const body = !isOpen ? null : (
        <div
            data-testid="scheduling-better-time-body"
            data-surface={isDesktop ? 'modal' : 'sheet'}
            className={isDesktop ? 'space-y-3' : PHONE_BODY}
        >
            {/* No intro paragraph on either viewport (ROK-1588): the week view's
                and the phone module's legends carry that meaning. */}
            {children}
        </div>
    );
    if (isDesktop) {
        return (
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={TITLE}
                maxWidth="max-w-5xl"
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
            ariaLabel={TITLE}
            maxHeight="95vh"
            initiallyExpanded
        >
            <div data-testid="scheduling-better-time-sheet" className="flex flex-col gap-3">
                <SheetTitleRow title={TITLE} onClose={onClose} testId="scheduling-better-time-header" />
                {body}
            </div>
        </BottomSheet>
    );
}

/**
 * The button that opens {@link SchedulingBetterTimeSheet}.
 *
 * It is the poll's one way out when no offered time suits, so it has to be
 * found: at every width it is the shared `Button` in its `warning-soft`
 * variant (a `/10` warning tint, `/30` border, warning label), which sets it
 * apart from the emerald vote buttons and the neutral "Doesn't work" ones.
 * History: ROK-1546 (AC6) replaced a dashed/muted "ghost" that read as
 * disabled chrome on a phone with a neutral outline below `lg`; the operator
 * then asked (2026-11-23) for a colour that stands out everywhere. Colours
 * come from the variant's tokens only (fifteen themes remap them).
 */
export function SchedulingBetterTimeTrigger({
    onClick,
}: {
    onClick: () => void;
}): JSX.Element {
    return (
        <Button
            variant="warning-soft"
            size="sm"
            fullWidth
            data-testid="scheduling-find-better-time"
            onClick={onClick}
        >
            <span aria-hidden="true">+</span>
            None of these work — find a better time
        </Button>
    );
}
