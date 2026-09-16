/**
 * Step 1 of the phone game-time check IS the week editor (ROK-1569).
 *
 * Operator ruling 2026-09-15 ("i want this one built") picked the Option A comp
 * — `dev/scheduling-wireframes/rok-1569-option-a-comp.html`, panel C of
 * `/dev/wireframes/scheduling`. Below 768px the check no longer asks four
 * questions and sends the viewer OUT to the profile editor: the week itself is
 * on screen, one day at a time, with the answers wrapped around it —
 * "Same as last week" (one tap, confirm-only), "I'm away…" (the absence row,
 * inline) and a sticky footer carrying "Save my week" / "Skip".
 *
 * The DESKTOP modal keeps the four-answer body (`GameTimeCheckBody`); it has
 * the room for the full grid on the profile page and is out of this story.
 *
 * `variant="profile"` is the SAME editor on the phone profile page (AC4: one
 * component, two mounts): no question, no "Same as last week", no Skip — the
 * absence row and the sticky Save stay, and the caller passes the profile's
 * full hour range (`PROFILE_HOURS`) so no daytime hour is lost.
 *
 * ROK-1579: "Save my week" also reports the check answered through
 * `useStepOneDone()`, which collapses the drawer it is mounted in (a no-op
 * anywhere else).
 *
 * No new pattern: the editor is Lane A's `PhoneWeekEditorCore`, the absence row
 * is the shipped `AbsenceSection`, and the buttons are the check's own recipes
 * from `game-time-check-copy.ts`. Every colour is a token.
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../game-time-grid.types';
import { AbsenceSection } from '../game-time-absence';
import { ANSWER_PRIMARY, ANSWER_SECONDARY, gameTimeCheckPrompt } from '../game-time-check-copy';
import { useStepOneDone } from '../../../../pages/scheduling/game-time-check-step';
import { useConfirmGameTime, useGameTime, useSaveGameTime } from '../../../../hooks/use-game-time';
import { PhoneWeekEditorCore } from './PhoneWeekEditorCore';
import { PROFILE_BLOCK_PRESETS, type BlockPreset, type BlockPresetControl } from '../block-presets';
import { PhoneWindowToggle } from './PhoneWindowToggle';
import { useProfileWindow } from './use-profile-window';
import { CHECK_HOURS, toTemplateInput, toTemplateSlots, usePhoneWeekDraft } from './phone-week-check.helpers';

/** Stable empty week — a new array each render would reset the draft. */
const NO_SLOTS: GameTimeSlot[] = [];

/** The one-tap answer: the saved week is still right, just stamp it fresh. */
function SameAsLastWeek(): JSX.Element {
    const confirm = useConfirmGameTime();
    return (
        <button
            type="button"
            data-testid="phone-week-same"
            className={ANSWER_PRIMARY}
            disabled={confirm.isPending}
            onClick={() =>
                confirm.mutate(undefined, {
                    onError: () => toast.error('Could not confirm your game time'),
                })
            }
        >
            {confirm.isPending ? 'Confirming…' : 'Same as last week'}
        </button>
    );
}

/** The absence answer: reveals the shipped absence form inline, never a page. */
function AwayAnswer(): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button
                type="button"
                data-testid="phone-week-away"
                aria-expanded={open}
                className={ANSWER_SECONDARY}
                onClick={() => setOpen((v) => !v)}
            >
                I&apos;m away…
            </button>
            {open && (
                <div
                    data-testid="phone-week-absence-panel"
                    className="max-h-[45%] overflow-y-auto rounded-lg border border-edge bg-panel/40 p-3"
                >
                    <AbsenceSection />
                </div>
            )}
        </>
    );
}

/** "Same as last week" needs a last week; a never-set viewer only gets away. */
function CheckAnswers({ hasSlots }: { hasSlots: boolean }): JSX.Element {
    return (
        <div className="flex flex-col gap-2">
            {hasSlots && <SameAsLastWeek />}
            <AwayAnswer />
        </div>
    );
}

interface StepFooterProps {
    slots: GameTimeSlot[];
    dirty: boolean;
    /** Omitted on the profile variant — there is nothing to skip there. */
    onSkip?: () => void;
}

/**
 * Writes the draft week; inert until it differs from the saved one. Sends the
 * TEMPLATE input (active hours as day/hour pairs) — never the composite rows.
 * The draft retires itself once the refetch matches it (`usePhoneWeekDraft`).
 */
function SaveWeekButton({ slots, dirty }: Omit<StepFooterProps, 'onSkip'>): JSX.Element {
    const save = useSaveGameTime();
    // ROK-1579: a saved week ends the check, so tell the shell (a no-op outside
    // a sheet). The drawer collapses on the write rather than on the refetch —
    // on the profile there is no gate to flip it, and on the poll the gate
    // clears staleness a moment later anyway.
    const done = useStepOneDone();
    const handleSave = (): void =>
        save.mutate(toTemplateInput(slots), {
            onSuccess: () => done(),
            onError: () => toast.error('Could not save your week'),
        });
    return (
        <button
            type="button"
            data-testid="phone-week-save"
            className={`${ANSWER_PRIMARY} flex-1 text-center`}
            disabled={!dirty || save.isPending}
            onClick={handleSave}
        >
            {save.isPending ? 'Saving…' : 'Save my week'}
        </button>
    );
}

/** The comp's `.bar`: pinned to the bottom of the sheet, never scrolled past. */
function StepFooter({ slots, dirty, onSkip }: StepFooterProps): JSX.Element {
    return (
        <div className="sticky bottom-0 -mx-4 flex items-center gap-2 border-t border-edge bg-surface px-4 py-2">
            <SaveWeekButton slots={slots} dirty={dirty} />
            {onSkip && (
                <button
                    type="button"
                    data-testid="phone-week-skip"
                    onClick={onSkip}
                    className="min-h-[44px] px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
                >
                    Skip
                </button>
            )}
        </div>
    );
}

/**
 * The profile's Evening / Whole day chips, and the window negotiation behind
 * them: "Whole day" starts at 9 AM, which the fitted window does not show, so
 * the chip asks for room, the window expands, and the preset is handed back to
 * the editor to apply once that hour exists (ROK-1579 frame 3).
 *
 * @param isCheck The poll's check has no presets — its window IS the evening.
 * @param expand Opens the full range so a preset's start hour can resolve.
 */
function useProfilePresets(isCheck: boolean, expand: () => void): BlockPresetControl | undefined {
    const [pending, setPending] = useState<BlockPreset | null>(null);
    const onNeedsRoom = useCallback((preset: BlockPreset) => { expand(); setPending(preset); }, [expand]);
    const onApplied = useCallback(() => setPending(null), []);
    // Stable identity: this object is an effect dependency downstream.
    const control = useMemo<BlockPresetControl>(
        () => ({ list: PROFILE_BLOCK_PRESETS, pending, onNeedsRoom, onApplied }),
        [pending, onNeedsRoom, onApplied],
    );
    return isCheck ? undefined : control;
}

export interface PhoneWeekCheckStepProps {
    /** Whole days since the last confirmation; `null` = never confirmed. */
    ageDays?: number | null;
    /** Whether the viewer has a saved week (drives the copy AND the one-tap answer). */
    hasSlots?: boolean;
    /** The caller's session-skip, rendered as "Skip" in the sticky footer (check only). */
    onSkip?: () => void;
    /** `check` = the poll sheet's step 1 (default); `profile` = editor + absences + Save. */
    variant?: 'check' | 'profile';
    /** Visible hours in the caller's order; defaults to the check's evening range. */
    hours?: number[];
    /**
     * @internal Pre-measured dims for tests only (jsdom is zero-sized) — see
     * `DayBlockEditor`. Not a layout knob.
     */
    dims?: GridDims;
    /**
     * @internal Pre-measured day-slot height for tests only (jsdom is
     * zero-sized), so the fitted window is deterministic. Not a layout knob.
     */
    slotHeight?: number;
}

/**
 * The phone week editor with the check's answers around it — see docstring.
 * The caller (the sheet) MUST give it a bounded height: the editor rows stretch
 * to fill it and nothing scrolls inside.
 */
export function PhoneWeekCheckStep({
    ageDays, hasSlots = false, onSkip, variant = 'check', hours = CHECK_HOURS, dims, slotHeight,
}: PhoneWeekCheckStepProps): JSX.Element {
    const { data } = useGameTime();
    const templateSlots = useMemo(() => toTemplateSlots(data?.slots ?? NO_SLOTS), [data?.slots]);
    const draft = usePhoneWeekDraft(templateSlots);
    const isCheck = variant === 'check';
    // The window the day slot can actually show (ROK-1579 frame 3). A range
    // that fits — the check's seven evening hours — comes back untouched.
    const hourWindow = useProfileWindow(hours, draft.slots, slotHeight);
    const presets = useProfilePresets(isCheck, hourWindow.expand);
    return (
        <div data-testid="phone-week-check" data-variant={variant} className="flex h-full min-h-0 flex-col gap-2">
            {isCheck && (
                <p data-testid="phone-week-prompt" className="text-sm text-foreground">
                    {gameTimeCheckPrompt(ageDays, hasSlots)}
                </p>
            )}
            {/* `min-h-0` keeps this slot's height DEFINITE inside the sheet's
                fixed box, so `h-full` below it means something: the day grid
                shrinks and scrolls under the inspector / absence panel instead
                of growing the column past the box (which re-measured the day
                slot, expanded the window to all 17 hours and pushed the
                inspector off screen). The day's own floor lives on the day slot
                (`min-h-[132px]` in PhoneWeekEditorCore). */}
            <div className="min-h-0 flex-1">
                <PhoneWeekEditorCore
                    slots={draft.slots} onChange={draft.setDraft} hours={hourWindow.hours}
                    initialDay={new Date().getDay()} dims={dims}
                    inspectorPlacement="flow"
                    daySlotRef={hourWindow.slotRef} presets={presets}
                    gridHeader={
                        <PhoneWindowToggle
                            allHours={hours} hiddenEarlier={hourWindow.hiddenEarlier}
                            expanded={hourWindow.expanded} onToggle={hourWindow.toggle}
                        />
                    }
                />
            </div>
            {isCheck ? <CheckAnswers hasSlots={hasSlots} /> : <AwayAnswer />}
            <StepFooter slots={draft.slots} dirty={draft.dirty} onSkip={isCheck ? onSkip : undefined} />
        </div>
    );
}
