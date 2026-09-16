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
import { PROFILE_HOURS } from '../phone-week-check.helpers';
import { PROFILE_WINDOW_KEY } from '../phone-window.helpers';

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
        // The strip is three band bars per day (lane 6); none may carry a hatch
        // and the probe must match real bars, not pass on an empty selection.
        const bars = [...document.querySelectorAll('[data-testid="phone-week-strip-bar"]')] as HTMLElement[];
        expect(bars).toHaveLength(21);
        for (const bar of bars) expect(bar.style.backgroundImage).toBe('');
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

/**
 * ROK-1579 — the drawer defect the Lead reproduced on the env (375×812, the
 * profile's 9am–1am range): opening "I'm away…" gave the absence panel 45% of
 * the sheet, the editor's flex slot collapsed to ZERO height, and the hour
 * labels, the week strip, the away row and the absence form all painted on top
 * of each other. Playwright then could not click the strip or the presets.
 *
 * jsdom has no layout, so this asserts the CSS contract that stops it: the
 * editor slot has no `min-h-0` escape hatch, so it cannot shrink past the
 * editor's own floor (pager + 132px of grid + strip) whatever opens below it.
 */
describe('PhoneWeekCheckStep — the absence panel cannot crush the editor (ROK-1579)', () => {
    const editorSlot = (): HTMLElement => screen.getByTestId('phone-week-editor').parentElement!;

    it('gives the editor slot a content floor instead of letting it shrink to nothing', () => {
        renderStep();
        expect(editorSlot().className).toContain('flex-1');
        expect(editorSlot().className).not.toContain('min-h-0');
    });

    it('keeps that floor while the absence panel is open, and lets the panel scroll itself', () => {
        renderStep();
        fireEvent.click(screen.getByTestId('phone-week-away'));
        expect(screen.getByTestId('phone-week-absence-panel').className).toContain('overflow-y-auto');
        expect(editorSlot().className).not.toContain('min-h-0');
        // The grid inside is the one that gives: it scrolls rather than squeezing.
        expect(screen.getByTestId('phone-day-grid').className).toContain('overflow-y-auto');
        expect(screen.getByTestId('phone-day-editor').className).toContain('min-h-[132px]');
    });
});

/**
 * ROK-1579 frame 3 — the profile drawer's window.
 *
 * The profile's 17 hours cannot fit a phone at the 44px touch row, and ROK-1569
 * squeezed them (illegible rows) while lane 4 made them scroll (the morning on
 * screen, the evening below the fold). The approved comp does neither: the
 * window is the rows that FIT, taken from the END, with the morning one tap away.
 */
describe('PhoneWeekCheckStep — the profile window (ROK-1579 frame 3)', () => {
    const rowCount = (): number => screen.getAllByTestId(/^phone-hour-/).length;
    /** 460px of day slot = ten 44px rows (eleven would need 484). */
    const profile = { variant: 'profile' as const, hours: PROFILE_HOURS, slotHeight: 460 };

    beforeEach(() => localStorage.clear());

    it('shows the rows that fit, taken from the end, so the window ends at 1 AM', () => {
        renderStep(profile);
        expect(rowCount()).toBe(10);
        expect(screen.getByTestId('phone-hour-16')).toBeInTheDocument(); // 4 PM, the window start
        expect(screen.getByTestId('phone-hour-1')).toBeInTheDocument(); // 1 AM, the window end
        expect(screen.queryByTestId('phone-hour-9')).not.toBeInTheDocument();
    });

    it('offers the earlier hours in a toggle that names them, and expands to the full range', () => {
        renderStep(profile);
        const toggle = screen.getByTestId('phone-week-show-earlier');
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle).toHaveTextContent('Show earlier (9 AM–4 PM)');

        fireEvent.click(toggle);
        expect(rowCount()).toBe(PROFILE_HOURS.length);
        expect(screen.getByTestId('phone-hour-9')).toBeInTheDocument();
        expect(screen.getByTestId('phone-week-show-earlier')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId('phone-week-show-earlier')).toHaveTextContent('Hide earlier');
    });

    it('does not offer the toggle when nothing is hidden — the check\'s seven evening hours', () => {
        renderStep();
        expect(screen.queryByTestId('phone-week-show-earlier')).not.toBeInTheDocument();
    });

    it('remembers an explicit choice per user', () => {
        renderStep(profile);
        fireEvent.click(screen.getByTestId('phone-week-show-earlier'));
        expect(localStorage.getItem(PROFILE_WINDOW_KEY)).toBe('full');

        localStorage.setItem(PROFILE_WINDOW_KEY, 'full');
        renderStep(profile);
        expect(screen.getAllByTestId('phone-hour-9').length).toBeGreaterThan(0);
    });

    it('opens expanded when the saved week has hours the window would hide (the shift worker)', () => {
        serverSlots = [{ dayOfWeek: 3, hour: 10, status: 'available' }];
        renderStep(profile);
        expect(rowCount()).toBe(PROFILE_HOURS.length);
        expect(screen.getByTestId('phone-week-show-earlier')).toHaveAttribute('aria-expanded', 'true');
    });

    it('lets an explicit "fit" outrank that auto-expand', () => {
        localStorage.setItem(PROFILE_WINDOW_KEY, 'fit');
        serverSlots = [{ dayOfWeek: 3, hour: 10, status: 'available' }];
        renderStep(profile);
        expect(rowCount()).toBe(10);
    });
});

/**
 * ROK-1579 frame 3 — the inspector's Evening / Whole day chips.
 *
 * The steppers move one hour per tap: an all-day Saturday is sixteen taps. The
 * chips are the coarse path, and they go through the SAME bounds model, so a
 * chip can no more cross a committed hour than a stepper can.
 */
describe('PhoneWeekCheckStep — the block presets (ROK-1579 frame 3)', () => {
    const profile = { variant: 'profile' as const, hours: PROFILE_HOURS, slotHeight: 460 };

    beforeEach(() => localStorage.clear());

    /** Tap the third row of the fitted window (6 PM) — drops the default two hours. */
    function paintThirdRow(): void {
        const target = screen.getByTestId('slot-day-target-0');
        fireEvent.pointerDown(target, { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
        fireEvent.pointerUp(screen.getByTestId('block-editor-layer'), { pointerId: 1, clientX: 10, clientY: 2 * ROW + 5 });
    }

    it('offers Evening and Whole day on the profile, unpressed for a two-hour block', () => {
        renderStep(profile);
        paintThirdRow();
        expect(screen.getByTestId('phone-block-preset-evening')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('phone-block-preset-whole-day')).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not offer them in the poll\'s check, whose window IS the evening', () => {
        renderStep();
        paintSunday19();
        expect(screen.getByTestId('phone-block-inspector')).toBeInTheDocument();
        expect(screen.queryByTestId('phone-block-preset-evening')).not.toBeInTheDocument();
    });

    it('stretches the block to 5 PM – 1 AM on Evening, and marks the chip pressed', () => {
        renderStep(profile);
        paintThirdRow();
        fireEvent.click(screen.getByTestId('phone-block-preset-evening'));
        expect(screen.getByTestId('start-value')).toHaveTextContent('5 PM');
        expect(screen.getByTestId('end-value')).toHaveTextContent('1 AM');
        expect(screen.getByTestId('phone-block-preset-evening')).toHaveAttribute('aria-pressed', 'true');
    });

    it('expands the window on Whole day, because 9 AM is not on screen to stretch to', () => {
        renderStep(profile);
        paintThirdRow();
        fireEvent.click(screen.getByTestId('phone-block-preset-whole-day'));
        expect(screen.getByTestId('phone-week-show-earlier')).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getAllByTestId(/^phone-hour-/)).toHaveLength(PROFILE_HOURS.length);
        expect(screen.getByTestId('start-value')).toHaveTextContent('9 AM');
        expect(screen.getByTestId('end-value')).toHaveTextContent('1 AM');
        expect(screen.getByTestId('phone-block-preset-whole-day')).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps the selection on the same block when the window grows under it', () => {
        renderStep(profile);
        paintThirdRow();
        expect(screen.getByTestId('start-value')).toHaveTextContent('6 PM');
        fireEvent.click(screen.getByTestId('phone-week-show-earlier'));
        expect(screen.getByTestId('start-value')).toHaveTextContent('6 PM');
        expect(screen.getByTestId('end-value')).toHaveTextContent('8 PM');
    });
});
