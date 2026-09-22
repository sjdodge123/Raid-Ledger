/**
 * The phone week check's buttons (ROK-1569), moved out of `PhoneWeekCheckStep`
 * unchanged for ROK-1585 so the step can grow its away swap and still shrink:
 * "Same as last week" (the one-tap answer) and the sticky footer carrying
 * "Save my week" / "Skip".
 */
import type { JSX } from 'react';
import { toast } from 'sonner';
import type { GameTimeSlot } from '@raid-ledger/contract';
import { ANSWER_PRIMARY } from '../game-time-check-copy';
import { useStepOneDone } from '../../../../pages/scheduling/game-time-check-step';
import { useConfirmGameTime, useSaveGameTime } from '../../../../hooks/use-game-time';
import { STEP_FOOTER_BAR, toTemplateInput } from './phone-week-check.helpers';

/** The one-tap answer: the saved week is still right, just stamp it fresh. */
export function SameAsLastWeek(): JSX.Element {
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

export interface StepFooterProps {
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

/** The comp's `.bar`: a `shrink-0` flex footer OUTSIDE the scroll body (ROK-1640), never scrolled past. */
export function StepFooter({ slots, dirty, onSkip }: StepFooterProps): JSX.Element {
    return (
        <div className={STEP_FOOTER_BAR}>
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
