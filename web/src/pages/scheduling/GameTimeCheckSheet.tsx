/**
 * The PHONE game-time check — two steps in one full-height sheet (ROK-1574).
 *
 * Wireframe B (`dev/scheduling-wireframes/SheetStepOne.tsx`, operator ruling
 * 2026-09-15): below 768px the check is not a short overlay that closes onto
 * the page — it opens full height with a two-segment stepper as its header,
 * "1 Game time" then "2 Vote", so the viewer answers one question and lands on
 * the ballot without hunting for it. There is no heatmap in either step; the
 * week painter never renders inside an overlay.
 *
 * Step 1 is a SLOT (`stepOne`), not a fixed body: today the composite fills it
 * with `GameTimeCheckBody`, and ROK-1569's phone week editor replaces that
 * without this shell changing. Whatever sits in the slot can call
 * `useStepOneDone()` to advance itself.
 *
 * Step 2 is the REAL ladder: the composite passes the very
 * `SchedulingSlotListProps` it renders on the page (`useSchedulingLadder`), so
 * a vote cast here is the same vote, announced and de-duped the same way.
 *
 * Advancing is DERIVED, like the closing it replaces: "Looks right", a saved
 * absence and Skip all end the check (server-side stamp or session skip),
 * which flips `isOpen` false — and a check that ends while step 1 is showing
 * advances to step 2 instead of vanishing. Only an explicit close dismisses it.
 *
 * No new pattern: the stepper is the house segmented-control idiom (see
 * `docs/design-system.md`), every colour is a `--color-*` token, and the
 * segments are 44px targets.
 */
import { useState, type JSX, type ReactNode } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import {
    SchedulingSlotList,
    type SchedulingSlotListProps,
} from '../../components/lineups/cycle-4/SchedulingSlotList';
import { StepOneDoneContext } from './game-time-check-step';

/** The sheet's two segments — both stay tappable in either direction. */
const SEGMENTS: readonly string[] = ['1 Game time', '2 Vote'];

/** The comp's `.stepline` — one mono, muted, uppercase line above the stepper. */
const STEP_LINES: readonly string[] = [
    'Step 1 of 2 · game time · then vote',
    'Step 2 of 2 · vote',
];

const SEGMENT_BASE =
    'min-h-[44px] flex-1 rounded-lg px-3 text-sm font-medium transition-colors';

/** One tappable segment; the current one carries `aria-current="step"`. */
function Segment({ n, label, step, onStep }: {
    n: 1 | 2;
    label: string;
    step: 1 | 2;
    onStep: (s: 1 | 2) => void;
}): JSX.Element {
    const active = n === step;
    return (
        <button
            type="button"
            data-testid={`game-time-check-step-${n}`}
            aria-current={active ? 'step' : undefined}
            onClick={() => onStep(n)}
            className={`${SEGMENT_BASE} ${
                active ? 'bg-overlay text-foreground' : 'text-muted hover:text-secondary'
            }`}
        >
            {label}
        </button>
    );
}

/** Two-segment stepper + close, pinned to the top of the sheet. */
function Stepper({ step, onStep, onClose }: {
    step: 1 | 2;
    onStep: (s: 1 | 2) => void;
    onClose: () => void;
}): JSX.Element {
    return (
        <div
            data-testid="game-time-check-stepper"
            className="-mx-4 -mt-4 mb-1 border-b border-edge px-2 py-1.5"
        >
            <p
                data-testid="game-time-check-stepline"
                className="px-1 pb-1 font-mono text-xs uppercase tracking-wide text-muted"
            >
                {STEP_LINES[step - 1]}
            </p>
            <div className="flex items-center gap-1">
            {SEGMENTS.map((label, i) => (
                <Segment
                    key={label}
                    n={(i + 1) as 1 | 2}
                    label={label}
                    step={step}
                    onStep={onStep}
                />
            ))}
            <button
                type="button"
                aria-label="Close sheet"
                onClick={onClose}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center text-muted transition-colors hover:text-foreground"
            >
                <XMarkIcon className="h-5 w-5" />
            </button>
            </div>
        </div>
    );
}

export interface GameTimeCheckSheetProps {
    /** The shared gate (`useGameTimeCheckGate`) — step 1 is due. */
    isOpen: boolean;
    /** Explicit dismissal; the composite treats it as a session skip. */
    onClose: () => void;
    /** The page's own ballot binding — step 2 renders it verbatim. */
    ladder: SchedulingSlotListProps;
    /** Step 1's body. It may call `useStepOneDone()` to advance itself. */
    stepOne: ReactNode;
}

/** Track which step is showing, advancing when the check ends on step 1. */
function useCheckStep(isOpen: boolean, dismissed: boolean): [1 | 2, (s: 1 | 2) => void] {
    const [step, setStep] = useState<1 | 2>(1);
    const [prevOpen, setPrevOpen] = useState(isOpen);
    if (isOpen !== prevOpen) {
        setPrevOpen(isOpen);
        if (!isOpen && !dismissed && step === 1) setStep(2);
    }
    return [step, setStep];
}

/** The phone game-time check — see file-level docstring. */
export function GameTimeCheckSheet(props: GameTimeCheckSheetProps): JSX.Element | null {
    const { isOpen, onClose, ladder, stepOne } = props;
    const [dismissed, setDismissed] = useState(false);
    const [step, setStep] = useCheckStep(isOpen, dismissed);

    // The sheet outlives the gate: once the check is answered the gate clears,
    // but step 2 (the ballot) stays up until the viewer closes it.
    if (dismissed || !(isOpen || step === 2)) return null;

    const handleClose = (): void => {
        setDismissed(true);
        onClose();
    };

    return (
        <BottomSheet
            isOpen
            onClose={handleClose}
            maxHeight="95vh"
            initiallyExpanded
            ariaLabel="Game time check"
        >
            <div data-testid="game-time-check-sheet" className="flex flex-col gap-3">
                <Stepper step={step} onStep={setStep} onClose={handleClose} />
                {step === 1 ? (
                    <StepOneDoneContext.Provider value={() => setStep(2)}>
                        {stepOne}
                    </StepOneDoneContext.Provider>
                ) : (
                    <div data-testid="game-time-check-step2">
                        <SchedulingSlotList {...ladder} />
                    </div>
                )}
            </div>
        </BottomSheet>
    );
}
