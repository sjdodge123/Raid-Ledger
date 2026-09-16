/**
 * Step 1 of the phone game-time check IS the week editor (ROK-1569).
 *
 * Option A comp (`dev/scheduling-wireframes/rok-1569-option-a-comp.html`):
 * prompt line, one day on screen, then the answers — "Same as last week" as the
 * one-tap confirm, "I'm away…" revealing the absence row inline, and a sticky
 * footer carrying "Save my week" / "Skip".
 *
 * jsdom reports every element as zero-sized, so the painting test passes
 * explicit `dims`, exactly as `PhoneWeekEditorCore.test.tsx` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { JSX } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../../game-time-grid.types';
import { StepOneDoneContext } from '../../../../../pages/scheduling/game-time-check-step';
import { PhoneWeekCheckStep } from '../PhoneWeekCheckStep';

const ROW = 26;
const DIMS: GridDims = { colWidth: 300, rowHeight: ROW, headerHeight: 0, colStartLeft: 52 };

const confirmMutate = vi.fn();
const saveMutate = vi.fn();
const onSkip = vi.fn();
let serverSlots: GameTimeSlot[] = [];
let stale = true;

vi.mock('../../../../../hooks/use-game-time', () => ({
    useGameTime: () => ({ data: { slots: serverSlots, gameTimeStale: stale } }),
    useConfirmGameTime: () => ({ mutate: confirmMutate, isPending: false }),
    useSaveGameTime: () => ({ mutate: saveMutate, isPending: false }),
}));

vi.mock('../../game-time-absence', () => ({
    AbsenceSection: (): JSX.Element => <div data-testid="absence-section">AbsenceSection</div>,
}));

function renderStep(props: Partial<Parameters<typeof PhoneWeekCheckStep>[0]> = {}) {
    return render(
        <PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} dims={DIMS} {...props} />,
    );
}

/** Tap the third visible hour (19:00) on Sunday — drops the default two hours. */
function paintSunday19(): void {
    const target = screen.getByTestId('slot-day-target-0');
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
    fireEvent.pointerUp(screen.getByTestId('block-editor-layer'), { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
}

beforeEach(() => {
    vi.clearAllMocks();
    serverSlots = [];
    stale = true;
    // The check opens on TODAY (review MINOR 8); pin the clock to a Sunday so
    // the painting helpers below land on day 0.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-13T12:00:00'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('PhoneWeekCheckStep — the prompt and the editor', () => {
    it('opens on today, not on Sunday', () => {
        vi.setSystemTime(new Date('2026-09-16T12:00:00')); // a Wednesday
        renderStep();
        expect(screen.getByTestId('phone-week-strip-day-3')).toHaveAttribute('aria-current', 'date');
    });

    it('asks the check question with the age of the saved week', () => {
        renderStep();
        expect(screen.getByTestId('phone-week-prompt')).toHaveTextContent(
            'Your game time is 9 days old. Anything changed?',
        );
    });

    it('asks the never-set question when the viewer has no week at all', () => {
        renderStep({ ageDays: null, hasSlots: false });
        expect(screen.getByTestId('phone-week-prompt')).toHaveTextContent(
            "You haven't set a game time yet. Anything to add?",
        );
    });

    it('renders the one-day editor (the bounded height is the sheet\'s — see GameTimeCheckSheet.test)', () => {
        renderStep();
        expect(screen.getByTestId('phone-week-editor')).toBeInTheDocument();
    });

    it('edits the TEMPLATE only — event commitments in the composite are not blocks here', () => {
        serverSlots = [
            { dayOfWeek: 0, hour: 19, status: 'available', fromTemplate: true },
            { dayOfWeek: 0, hour: 21, status: 'committed', fromTemplate: false },
        ];
        renderStep();
        expect(screen.getByTestId('slot-block-0-19')).toBeInTheDocument();
        expect(screen.queryByTestId('slot-block-0-21')).not.toBeInTheDocument();
    });

    it('shows the evening hours the comp shows — 6pm through midnight', () => {
        renderStep();
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(7);
        expect(screen.getByTestId('phone-hour-17')).toBeInTheDocument();
        expect(screen.getByTestId('phone-hour-23')).toBeInTheDocument();
    });

    // ROK-1579 (operator ruling 2026-09-16: "I don't like the cross-hatch
    // visual"). `stale` is true in this suite's server mock, which is exactly
    // the state that used to paint a diagonal hatch over every unclaimed hour.
    it('never hatches the grid or the strip, even when the saved week IS stale', () => {
        renderStep();
        const cells = [...document.querySelectorAll('[data-testid^="phone-cell-0-"]')] as HTMLElement[];
        expect(cells).toHaveLength(7);
        for (const cell of cells) {
            expect(cell.style.backgroundImage).toBe('');
            expect(cell.className).not.toContain('amber');
        }
        expect(document.querySelectorAll('[data-bar="stale"]')).toHaveLength(0);
    });
});

describe('PhoneWeekCheckStep — the answers', () => {
    it('confirms the saved week on "Same as last week"', () => {
        renderStep();
        fireEvent.click(screen.getByTestId('phone-week-same'));
        expect(confirmMutate).toHaveBeenCalledTimes(1);
    });

    it('offers no "Same as last week" when there is no last week to keep', () => {
        renderStep({ ageDays: null, hasSlots: false });
        expect(screen.queryByTestId('phone-week-same')).not.toBeInTheDocument();
    });

    it('reveals the absence row inline under "I\'m away…"', () => {
        renderStep();
        const away = screen.getByTestId('phone-week-away');
        expect(away).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId('phone-week-absence-panel')).not.toBeInTheDocument();

        fireEvent.click(away);
        expect(away).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('phone-week-absence-panel')).toBeInTheDocument();
        expect(screen.getByTestId('absence-section')).toBeInTheDocument();
    });

    it('skips through the caller', () => {
        renderStep();
        fireEvent.click(screen.getByTestId('phone-week-skip'));
        expect(onSkip).toHaveBeenCalledTimes(1);
    });
});

describe('PhoneWeekCheckStep — the sticky footer saves the edited week', () => {
    it('keeps Save disabled until the week actually changes', () => {
        renderStep();
        expect(screen.getByTestId('phone-week-save')).toBeDisabled();
    });

    it('saves the edited draft as template day/hour pairs — never the composite rows', () => {
        // An event commitment on Wednesday lives in the composite view only; a
        // save must not turn it into weekly availability (review MAJOR 1).
        serverSlots = [{ dayOfWeek: 3, hour: 20, status: 'committed', fromTemplate: false }];
        renderStep();
        paintSunday19();
        const save = screen.getByTestId('phone-week-save');
        expect(save).toBeEnabled();

        fireEvent.click(save);
        expect(saveMutate).toHaveBeenCalledTimes(1);
        expect(saveMutate.mock.calls[0][0]).toEqual([
            { dayOfWeek: 0, hour: 19 },
            { dayOfWeek: 0, hour: 20 },
        ]);
    });

    it('keeps the edits on screen until the server catches up, then follows it', () => {
        const { rerender } = renderStep();
        paintSunday19();
        expect(screen.getByTestId('slot-block-0-19')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-save')).toBeEnabled();

        // The refetch lands with the saved week: the draft retires, Save goes quiet.
        serverSlots = [
            { dayOfWeek: 0, hour: 19, status: 'available', fromTemplate: true },
            { dayOfWeek: 0, hour: 20, status: 'available', fromTemplate: true },
        ];
        rerender(<PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} dims={DIMS} />);
        expect(screen.getByTestId('slot-block-0-19')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-save')).toBeDisabled();
    });

    it('follows the server copy while the draft is untouched', () => {
        const { rerender } = renderStep();
        expect(screen.queryByTestId('slot-block-0-19')).not.toBeInTheDocument();

        serverSlots = [{ dayOfWeek: 0, hour: 19, status: 'available' }];
        rerender(<PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} dims={DIMS} />);
        expect(screen.getByTestId('slot-block-0-19')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-save')).toBeDisabled();
    });
});

describe('PhoneWeekCheckStep — the profile variant (AC4: the same editor on the profile page)', () => {
    it('drops the question, "Same as last week" and Skip; keeps the editor, the absence row and Save', () => {
        renderStep({ variant: 'profile' });
        expect(screen.queryByTestId('phone-week-prompt')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-same')).not.toBeInTheDocument();
        expect(screen.queryByTestId('phone-week-skip')).not.toBeInTheDocument();
        expect(screen.getByTestId('phone-week-editor')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-away')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-save')).toBeInTheDocument();
    });

    it('keeps the inspector in flow on the profile too — it lives in the same drawer now (ROK-1579)', () => {
        // A `fixed` inspector would resolve against the sheet panel's transform and
        // land on the sticky Save bar (review MINOR 3), so both mounts use flow.
        vi.setSystemTime(new Date('2026-09-13T12:00:00')); // a Sunday
        renderStep({ variant: 'profile' });
        paintSunday19();
        expect(screen.getByTestId('phone-block-inspector')).toHaveAttribute('data-placement', 'flow');
        expect(screen.getByTestId('phone-block-inspector').className).not.toContain('fixed');
    });

    it('keeps the inspector in flow inside the check sheet', () => {
        renderStep();
        paintSunday19();
        expect(screen.getByTestId('phone-block-inspector')).toHaveAttribute('data-placement', 'flow');
    });

    it('honours the caller\'s hour range', () => {
        renderStep({ variant: 'profile', hours: [9, 10, 11] });
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(3);
        expect(screen.getByTestId('phone-hour-9')).toBeInTheDocument();
    });
});

describe('PhoneWeekCheckStep — a save collapses the drawer (ROK-1579)', () => {
    afterEach(() => saveMutate.mockReset());

    /** Render inside a sheet that is listening for "the check is answered". */
    function renderInSheet(done: () => void) {
        return render(
            <StepOneDoneContext.Provider value={done}>
                <PhoneWeekCheckStep ageDays={9} hasSlots onSkip={onSkip} dims={DIMS} />
            </StepOneDoneContext.Provider>,
        );
    }

    it('reports the check answered as soon as the save lands, so the drawer collapses without waiting for the refetch', () => {
        const done = vi.fn();
        saveMutate.mockImplementation((_slots: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
        renderInSheet(done);
        paintSunday19();

        fireEvent.click(screen.getByTestId('phone-week-save'));
        expect(saveMutate).toHaveBeenCalledTimes(1);
        expect(done).toHaveBeenCalledTimes(1);
    });

    it('leaves the drawer up when the save fails', () => {
        const done = vi.fn();
        saveMutate.mockImplementation((_slots: unknown, opts?: { onError?: (e: Error) => void }) =>
            opts?.onError?.(new Error('nope')),
        );
        renderInSheet(done);
        paintSunday19();

        fireEvent.click(screen.getByTestId('phone-week-save'));
        expect(done).not.toHaveBeenCalled();
    });
});
