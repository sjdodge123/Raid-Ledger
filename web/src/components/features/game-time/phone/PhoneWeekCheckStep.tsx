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
 * `variant="profile"` is the same editor with only the footer — the phone
 * profile page edits a week without being asked a question about it.
 *
 * No new pattern: the editor is Lane A's `PhoneWeekEditorCore`, the absence row
 * is the shipped `AbsenceSection`, and the buttons are the check's own recipes
 * from `game-time-check-copy.ts`. Every colour is a token.
 */
import { useState, type JSX } from 'react';
import { toast } from 'sonner';
import type { GameTimeSlot } from '@raid-ledger/contract';
import type { GridDims } from '../game-time-grid.types';
import { AbsenceSection } from '../game-time-absence';
import { ANSWER_PRIMARY, ANSWER_SECONDARY, gameTimeCheckPrompt } from '../game-time-check-copy';
import { useConfirmGameTime, useGameTime, useSaveGameTime } from '../../../../hooks/use-game-time';
import { PhoneWeekEditorCore } from './PhoneWeekEditorCore';
import { CHECK_HOURS, usePhoneWeekDraft } from './phone-week-check.helpers';

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
                    className="rounded-lg border border-edge bg-panel/40 p-3"
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
    onSaved: () => void;
    /** Omitted on the profile variant — there is nothing to skip there. */
    onSkip?: () => void;
}

/** Writes the draft week; inert until it differs from the saved one. */
function SaveWeekButton({ slots, dirty, onSaved }: Omit<StepFooterProps, 'onSkip'>): JSX.Element {
    const save = useSaveGameTime();
    const handleSave = (): void =>
        save.mutate(slots, {
            onError: () => toast.error('Could not save your week'),
            onSuccess: onSaved,
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
function StepFooter({ slots, dirty, onSaved, onSkip }: StepFooterProps): JSX.Element {
    return (
        <div className="sticky bottom-0 -mx-4 flex items-center gap-2 border-t border-edge bg-surface px-4 py-2">
            <SaveWeekButton slots={slots} dirty={dirty} onSaved={onSaved} />
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

export interface PhoneWeekCheckStepProps {
    /** Whole days since the last confirmation; `null` = never confirmed. */
    ageDays?: number | null;
    /** Whether the viewer has a saved week (drives the copy AND the one-tap answer). */
    hasSlots?: boolean;
    /** The caller's session-skip; the check variant renders it as "Skip". */
    onSkip?: () => void;
    /** `check` = the poll sheet's step 1; `profile` = the editor plus Save only. */
    variant?: 'check' | 'profile';
    /** Pre-measured dims — see `DayBlockEditor`; tests pass it (jsdom is zero-sized). */
    dims?: GridDims;
}

/** The phone week editor with the check's answers around it — see docstring. */
export function PhoneWeekCheckStep({
    ageDays, hasSlots = false, onSkip, variant = 'check', dims,
}: PhoneWeekCheckStepProps): JSX.Element {
    const { data } = useGameTime();
    const draft = usePhoneWeekDraft(data?.slots ?? NO_SLOTS);
    const isCheck = variant === 'check';
    return (
        <div data-testid="phone-week-check" className="flex h-full min-h-0 flex-col gap-2">
            {isCheck && (
                <p data-testid="phone-week-prompt" className="text-sm text-foreground">
                    {gameTimeCheckPrompt(ageDays, hasSlots)}
                </p>
            )}
            <div className="min-h-0 flex-1">
                <PhoneWeekEditorCore
                    slots={draft.slots} onChange={draft.setDraft} hours={CHECK_HOURS}
                    stale={!!data?.gameTimeStale} dims={dims}
                />
            </div>
            {isCheck && <CheckAnswers hasSlots={hasSlots} />}
            <StepFooter
                slots={draft.slots}
                dirty={draft.dirty}
                onSaved={draft.reset}
                onSkip={isCheck ? onSkip : undefined}
            />
        </div>
    );
}
