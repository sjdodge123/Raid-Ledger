/**
 * Shared Cancel + destructive-confirm footer for lineup modals (ROK-1219).
 * Extracted from AbortLineupModal (ROK-1062). Parameterized confirm/pending
 * labels so cancel-poll and abort-lineup share one footer.
 */
import type { JSX } from 'react';

interface DestructiveModalFooterProps {
    onCancel: () => void;
    onConfirm: () => void;
    isPending: boolean;
    /** Label for the destructive confirm button (e.g. "Abort Lineup"). */
    confirmLabel: string;
    /** Label shown while the mutation is pending (e.g. "Aborting..."). */
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
        <div className="flex justify-end gap-3 pt-2">
            <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-secondary bg-panel border border-edge rounded-lg hover:bg-overlay transition-colors"
            >
                Cancel
            </button>
            <button
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-500 transition-colors disabled:opacity-50"
            >
                {isPending && (
                    <span
                        aria-hidden="true"
                        className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin"
                    />
                )}
                {isPending ? pendingLabel : confirmLabel}
            </button>
        </div>
    );
}
