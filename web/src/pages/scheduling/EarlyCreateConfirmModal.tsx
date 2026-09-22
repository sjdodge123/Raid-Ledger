/**
 * Lock-in confirmation modal. Below the majority-voter threshold it warns
 * about an early Create/Reschedule (ROK-1121); at or above it (only reachable
 * via the DM `?lock=` deep link, ROK-1604) it asks a neutral "lock in?".
 *
 * ROK-1617 follow-up (item C): both branches say "picked this time", never
 * "have voted on this time" — `distinctVoters` counts the supporters of THIS
 * slot, which is what the leading card and the API comment already call it.
 */
import type { JSX } from 'react';
import { computeRequiredVoters } from './threshold';

interface EarlyCreateConfirmModalProps {
    distinctVoters: number;
    memberCount: number;
    /** Human-readable slot time for the neutral variant's title. */
    timeLabel: string;
    /**
     * ROK-1610: `expired` is the post-deadline organiser lock-in. It never
     * warns about an early create — the deadline is behind us — it names who
     * the lock-in signs up, which is the slot's voters and nobody else.
     */
    variant?: 'lock' | 'expired';
    onCancel: () => void;
    onConfirm: () => void;
}

interface ModalCopy {
    title: string;
    body: string;
    confirm: string;
}

/** Pick early-lock or neutral copy from the (fresh) voter counts. */
function modalCopy(props: EarlyCreateConfirmModalProps): ModalCopy {
    const { distinctVoters, memberCount, timeLabel } = props;
    if (props.variant === 'expired') {
        return {
            title: `Schedule ${timeLabel}?`,
            body: `${distinctVoters} of ${memberCount} picked this time — they get signed up and a Discord card.`,
            confirm: 'Schedule it',
        };
    }
    if (distinctVoters < computeRequiredVoters(memberCount)) {
        return {
            title: 'Create event below majority?',
            body: `Only ${distinctVoters} of ${memberCount} participants picked this time. Create event anyway?`,
            confirm: 'Create anyway',
        };
    }
    return {
        title: `Lock in ${timeLabel} for everyone?`,
        body: `${distinctVoters} of ${memberCount} participants picked this time.`,
        confirm: 'Lock in',
    };
}

/** Confirm dialog rendered from `useSchedulingLock().pendingSlot`. */
export function EarlyCreateConfirmModal(
    props: EarlyCreateConfirmModalProps,
): JSX.Element {
    const copy = modalCopy(props);
    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
            <div className="w-full max-w-md rounded-lg border border-edge bg-panel p-5 shadow-xl">
                <h4 className="text-base font-semibold text-foreground">
                    {copy.title}
                </h4>
                <p className="mt-2 text-sm text-muted">{copy.body}</p>
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={props.onCancel}
                        className="px-4 py-2 text-sm font-medium rounded-lg border border-edge text-foreground hover:bg-panel-hover transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={props.onConfirm}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                    >
                        {copy.confirm}
                    </button>
                </div>
            </div>
        </div>
    );
}
