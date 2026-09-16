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
 * No new pattern: the shell is the shipped `BottomSheet`, the header is its
 * house title row (drawn here so the close keeps its "Close sheet" name), and
 * every colour is a `--color-*` token.
 */
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { StepOneDoneContext } from './game-time-check-step';
import { SheetTitleRow } from './SheetTitleRow';

/** The sheet's default title — the question itself is the body's prompt line. */
const TITLE = 'Your game time';

/**
 * A DEFINITE height for the body: the week editor stretches its rows to fill it
 * and never scrolls inside — the sheet only has a max-height (ROK-1569 review).
 * 200px = handle + body padding + header; 180px left 9px of inner scroll on a
 * Pixel 5 (fleet gate), and the ROK-1579 header is no taller than the stepper
 * it replaced.
 */
const CONTENT_BOX = 'h-[calc(95dvh-200px)] min-h-0';

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

    return (
        <BottomSheet
            isOpen
            onClose={handleClose}
            maxHeight="95vh"
            initiallyExpanded
            ariaLabel="Game time check"
        >
            <div data-testid="game-time-check-sheet" className="flex flex-col gap-3">
                <SheetTitleRow title={title} onClose={handleClose} testId="game-time-check-header" />
                <StepOneDoneContext.Provider value={handleDone}>
                    <div data-testid="game-time-check-content" className={CONTENT_BOX}>
                        {body}
                    </div>
                </StepOneDoneContext.Provider>
            </div>
        </BottomSheet>
    );
}
