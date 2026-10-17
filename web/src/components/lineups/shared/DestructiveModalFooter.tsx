/**
 * Shared Cancel + destructive-confirm footer for lineup modals (ROK-1219).
 * Extracted from AbortLineupModal (ROK-1062). Parameterized confirm/pending
 * labels so cancel-poll and abort-lineup share one footer.
 *
 * ROK-1651/1655: rendered in the pinned Modal `footer` slot (which owns the
 * row layout), on the Button primitive. While pending the confirm is a
 * `loading` Button (aria-busy + aria-disabled, the click is swallowed) whose
 * sr-only name is `pendingLabel` (ruling 7). Callers pass the dirty-close
 * guard's `requestClose` as `onCancel`, so the explicit Cancel is guarded too.
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';

interface DestructiveModalFooterProps {
    onCancel: () => void;
    onConfirm: () => void;
    isPending: boolean;
    /** Label for the destructive confirm button (e.g. "Abort Lineup"). */
    confirmLabel: string;
    /** Accessible name while the mutation is pending (e.g. "Aborting..."). */
    pendingLabel: string;
}

export function DestructiveModalFooter({
    onCancel,
    onConfirm,
    isPending,
    confirmLabel,
    pendingLabel,
}: DestructiveModalFooterProps): JSX.Element {
    return (
        <>
            <Button variant="secondary" onClick={onCancel}>
                Cancel
            </Button>
            <Button
                variant="destructive"
                onClick={onConfirm}
                loading={isPending}
                loadingLabel={pendingLabel}
            >
                {confirmLabel}
            </Button>
        </>
    );
}
