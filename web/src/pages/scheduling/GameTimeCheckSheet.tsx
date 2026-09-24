/**
 * The PHONE game-time check — ONE question in a full-height sheet (ROK-1579).
 *
 * It began as a two-step stepper ("1 Game time" → "2 Vote", ROK-1574). The
 * operator ruled that out on 2026-09-16 — "I don't like the tabbed view for
 * game time and vote inside the drawer. Just remove that tabbed view; when I
 * click Save or Skip, collapse the drawer." — so the sheet now carries the week
 * editor and nothing else: a title row, the body, and a close.
 *
 * The ballot is the PAGE's ladder, which the sheet collapses onto. That is why
 * there is no `ladder` prop any more and no ladder in this file: one ballot in
 * the DOM, bound once by `useSchedulingLadder`.
 *
 * The body is a SLOT, not a fixed component: today the composite fills it with
 * ROK-1569's phone week editor (`PhoneWeekCheckStep`). Whatever sits there can
 * call `useStepOneDone()` to collapse the sheet itself.
 *
 * Collapsing is DERIVED, as it always was: "Same as last week", a saved week, a
 * saved absence and Skip all end the check (server-side stamp or session skip),
 * which flips `isOpen` false and takes the sheet with it. The close button and
 * the done seam are the same explicit path — a session skip.
 *
 * ROK-1585: the body may swap the title row ("‹ I'm away") through
 * `SheetHeaderContext`; `null` restores the default title.
 *
 * ROK-1640: every close path (×, backdrop, swipe-down, Escape) runs through
 * `useDirtyCloseGuard` — with unsaved edits (the body reports them through
 * `useReportSheetDirty`) it asks "Discard your changes?" instead of silently
 * dropping the times just entered. All three entry points (profile route, the
 * poll's check, the More drawer's Game Time row) mount this sheet, so all
 * three get it.
 *
 * No new pattern: the shell is the shipped `BottomSheet`, the header is its
 * house title row (drawn here so the close keeps its "Close sheet" name), and
 * every colour is a `--color-*` token.
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { StepOneDoneContext } from './game-time-check-step';
import { SheetTitleRow } from './SheetTitleRow';
import { SheetHeaderContext, type SheetHeaderOverride } from './sheet-header-context';
import { SheetDirtyContext, useSheetDirtySources } from '../../components/features/game-time/sheet-dirty-context';
import { useDirtyCloseGuard } from '../../hooks/use-dirty-close-guard';
import { DiscardChangesConfirm } from '../../components/ui/discard-changes-confirm';

/** The sheet's default title — the question itself is the body's prompt line. */
const TITLE = 'Your game time';

/**
 * A DEFINITE height for the body: the week editor stretches its rows to fill it
 * and never scrolls inside — the sheet only has a max-height (ROK-1569 review).
 * 200px = handle + body padding + header; 180px left 9px of inner scroll on a
 * Pixel 5 (fleet gate), and the ROK-1579 header is no taller than the stepper
 * it replaced.
 * `--sheet-vh` is 1% of the VISIBLE viewport, set by `BottomSheet` (ROK-1640:
 * `95dvh` overshot a real iPad's screen and pushed Save below it).
 */
const CONTENT_BOX = 'h-[calc(var(--sheet-vh,1dvh)_*_95_-_200px)] min-h-0';

export interface GameTimeCheckSheetProps {
    /** The shared gate (`useGameTimeCheckGate`) — the check is due. */
    isOpen: boolean;
    /** Explicit dismissal; the composite treats it as a session skip. */
    onClose: () => void;
    /**
     * The body ANSWERED (Save / Same as last week / absence saved). Collapses the
     * sheet without recording a session skip; defaults to `onClose`.
     */
    onDone?: () => void;
    /** The sheet's one body. It may call `useStepOneDone()` to collapse the sheet. */
    body: ReactNode;
    /**
     * Title row copy. Defaults to the poll check's question framing; the
     * profile's own "Edit my week" opens the same sheet as "My game time"
     * (ROK-1579) — one header, not a second one stacked inside the body.
     */
    title?: string;
    /** Reports whether the sheet is on screen (the composite hides its ladder). */
    onVisibleChange?: (visible: boolean) => void;
}

/** The phone game-time check — see file-level docstring. */
export function GameTimeCheckSheet(props: GameTimeCheckSheetProps): JSX.Element | null {
    const { isOpen, onClose, onDone, body, onVisibleChange, title = TITLE } = props;
    const [dismissed, setDismissed] = useState(false);

    const visible = isOpen && !dismissed;
    useEffect(() => { onVisibleChange?.(visible); }, [visible, onVisibleChange]);

    // Closing is the session skip (the check was declined) — and the body's
    // "done" seam takes the very same path, so a save collapses the drawer
    // without waiting for the refetch to flip the gate.
    const handleClose = (): void => {
        setDismissed(true);
        onClose();
    };
    const handleDone = (): void => {
        setDismissed(true);
        (onDone ?? onClose)();
    };

    if (!visible) return null;
    return <CheckSheetFrame title={title} onClose={handleClose} onDone={handleDone} body={body} />;
}

interface CheckSheetFrameProps {
    title: string;
    onClose: () => void;
    onDone: () => void;
    body: ReactNode;
}

/** The open sheet: title row (or the body's override), then the bounded body. */
function CheckSheetFrame({ title, onClose, onDone, body }: CheckSheetFrameProps): JSX.Element {
    const [header, setHeader] = useState<SheetHeaderOverride | null>(null);
    const { dirty, report } = useSheetDirtySources();
    const guard = useDirtyCloseGuard(dirty, onClose);
    return (
        <BottomSheet isOpen onClose={guard.requestClose} maxHeight="95vh" initiallyExpanded ariaLabel="Game time check">
            <div data-testid="game-time-check-sheet" className="flex flex-col gap-3">
                <SheetTitleRow
                    title={header?.title ?? title} onClose={guard.requestClose} testId="game-time-check-header"
                    onBack={header?.onBack} backLabel={header?.backLabel} backTestId={header?.backTestId}
                />
                <SheetHeaderContext.Provider value={setHeader}>
                    <SheetDirtyContext.Provider value={report}>
                        <StepOneDoneContext.Provider value={onDone}>
                            <div data-testid="game-time-check-content" className={CONTENT_BOX}>
                                {body}
                            </div>
                        </StepOneDoneContext.Provider>
                    </SheetDirtyContext.Provider>
                </SheetHeaderContext.Provider>
            </div>
            <DiscardChangesConfirm
                isOpen={guard.confirming}
                onKeep={guard.keep}
                onDiscard={guard.discard}
                message="The times you just entered haven't been saved yet."
            />
        </BottomSheet>
    );
}
