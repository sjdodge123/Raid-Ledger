/**
 * Confirmation modal for early Create/Reschedule when the majority-voter
 * threshold is not met (ROK-1121).
 */
import type { JSX } from 'react';

interface EarlyCreateConfirmModalProps {
    distinctVoters: number;
    memberCount: number;
    onCancel: () => void;
    onConfirm: () => void;
}

export function EarlyCreateConfirmModal({
    distinctVoters,
    memberCount,
    onCancel,
    onConfirm,
}: EarlyCreateConfirmModalProps): JSX.Element {
    return (
        <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
            <div className="w-full max-w-md rounded-lg border border-edge bg-panel p-5 shadow-xl">
                <h4 className="text-base font-semibold text-foreground">
                    Create event below majority?
                </h4>
                <p className="mt-2 text-sm text-muted">
                    Only {distinctVoters} of {memberCount} participants have voted on this time. Create event anyway?
                </p>
                <div className="mt-4 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-4 py-2 text-sm font-medium rounded-lg border border-edge text-foreground hover:bg-panel-hover transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
                    >
                        Create anyway
                    </button>
                </div>
            </div>
        </div>
    );
}
