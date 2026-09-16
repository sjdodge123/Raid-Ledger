/**
 * Step 1 of the phone game-time check IS the week editor (ROK-1569).
 *
 * Operator ruling 2026-09-15 ("i want this one built") picked the Option A comp
 * — `dev/scheduling-wireframes/rok-1569-option-a-comp.html`, panel C of
 * `/dev/wireframes/scheduling`. Below 768px the check no longer asks four
 * questions and sends the viewer OUT to the profile editor: the week itself is
 * on screen, one day at a time, with the answers wrapped around it —
 * "Same as last week" (one tap, confirm-only), "I'm away" (a row that swaps the
 * drawer to the away view) and a sticky footer carrying "Save my week" / "Skip".
 *
 * The DESKTOP modal keeps the four-answer body (`GameTimeCheckBody`); it has
 * the room for the full grid on the profile page and is out of this story.
 *
 * ROK-1584 §3: the profile's day reaches all 24 hours through two quiet
 * toggles — "Show earlier" above the day and "Show later" below it — so the
 * default view stays the evening while no hour is unreachable.
 *
 * `variant="profile"` is the SAME editor on the phone profile page (AC4: one
 * component, two mounts): no question, no "Same as last week", no Skip — the
 * away row and the sticky Save stay, and the caller passes the profile's
 * full hour range (`PROFILE_HOURS`) so no daytime hour is lost.
 *
 * ROK-1579: "Save my week" also reports the check answered through
 * `useStepOneDone()`, which collapses the drawer it is mounted in (a no-op
 * anywhere else).
 *
 * ROK-1585 drawer A: "I'm away ›" swaps the drawer to `PhoneAwayView` under a
 * "‹ I'm away" header (`useSheetHeader`). The week stays MOUNTED under `hidden`
 * while away, so the unsaved draft and the selected day survive the round trip;
 * the strip marks the next seven days' away days.
 *
 * No new pattern: the editor is `PhoneWeekEditorCore`, the away view is the
 * shared `AwayPanel`, and the buttons are the check's own recipes from
 * `game-time-check-copy.ts`. Every colour is a token.
 */
import { useCallback, useMemo, useState, type JSX } from 'react';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../game-time-grid.types';
import { gameTimeCheckPrompt } from '../game-time-check-copy';
import { useGameTime } from '../../../../hooks/use-game-time';
import { PhoneWeekEditorCore } from './PhoneWeekEditorCore';
import { PROFILE_BLOCK_PRESETS, type BlockPreset, type BlockPresetControl } from '../block-presets';
import { PhoneWindowToggle } from './PhoneWindowToggle';
import { useProfileWindow } from './use-profile-window';
import { CHECK_HOURS, toTemplateSlots, usePhoneWeekDraft } from './phone-week-check.helpers';
import { SameAsLastWeek, StepFooter } from './phone-week-check-footer';
import { AwayEntry, PhoneAwayView } from './PhoneAwayView';
import { useAwaySummary, useAwayView } from './use-away-view';

/** Stable empty week — a new array each render would reset the draft. */
const NO_SLOTS: GameTimeSlot[] = [];

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
export function PhoneWeekCheckStep(props: PhoneWeekCheckStepProps): JSX.Element {
    const { away, openAway } = useAwayView();
    const variant = props.variant ?? 'check';
    return (
        <div data-testid="phone-week-check" data-variant={variant} className="flex h-full min-h-0 flex-col">
            <WeekView {...props} hidden={away} onAway={openAway} />
            {away && <PhoneAwayView />}
        </div>
    );
}

type WeekViewProps = PhoneWeekCheckStepProps & { hidden: boolean; onAway: () => void };

/** The week: prompt, editor, answers, sticky Save — kept mounted while away. */
function WeekView({
    ageDays, hasSlots = false, onSkip, variant = 'check', hours = CHECK_HOURS, dims, slotHeight, hidden, onAway,
}: WeekViewProps): JSX.Element {
    const { data } = useGameTime();
    const templateSlots = useMemo(() => toTemplateSlots(data?.slots ?? NO_SLOTS), [data?.slots]);
    const draft = usePhoneWeekDraft(templateSlots);
    const isCheck = variant === 'check';
    // The window the day slot can actually show (ROK-1579 frame 3). A range
    // that fits — the check's seven evening hours — comes back untouched.
    const hourWindow = useProfileWindow(hours, draft.slots, slotHeight);
    const presets = useProfilePresets(isCheck, hourWindow.expand);
    const { awayDays, nextLabel } = useAwaySummary();
    return (
        <div data-testid="phone-week-view" hidden={hidden} className={hidden ? 'hidden' : 'flex h-full min-h-0 flex-col gap-2'}>
            {isCheck && (
                <p data-testid="phone-week-prompt" className="text-sm text-foreground">
                    {gameTimeCheckPrompt(ageDays, hasSlots)}
                </p>
            )}
            {/* `min-h-0` keeps this slot's height DEFINITE inside the sheet's
                fixed box, so the day grid scrolls instead of growing the column
                (ROK-1579). The day's own floor lives on the day slot
                (`min-h-[132px]` in PhoneWeekEditorCore). */}
            <div className="min-h-0 flex-1">
                <PhoneWeekEditorCore
                    slots={draft.slots} onChange={draft.setDraft} hours={hourWindow.hours}
                    initialDay={new Date().getDay()} dims={dims} awayDays={awayDays}
                    inspectorPlacement="flow"
                    daySlotRef={hourWindow.slotRef} presets={presets}
                    gridHeader={<PhoneWindowToggle direction="earlier" band={hourWindow.earlier} />}
                    gridFooter={<PhoneWindowToggle direction="later" band={hourWindow.later} />}
                />
            </div>
            <div className="flex flex-col gap-2">
                {isCheck && hasSlots && <SameAsLastWeek />}
                <AwayEntry nextLabel={nextLabel} onOpen={onAway} />
            </div>
            <StepFooter slots={draft.slots} dirty={draft.dirty} onSkip={isCheck ? onSkip : undefined} />
        </div>
    );
}
