/**
 * AbortLineupModal (ROK-1062).
 * Confirms the destructive abort action with an optional reason.
 * Opened from AbortLineupButton on the lineup detail page.
 */
import { useState, type JSX } from 'react';
import { Modal } from '../ui/modal';
import { useAbortLineup } from '../../hooks/use-lineups';
import { toast } from '../../lib/toast';

interface Props {
    lineupId: number;
    onClose: () => void;
}

const REASON_MAX = 500;

function ReasonField({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}): JSX.Element {
    return (
        <div>
            <div className="flex items-center justify-between mb-1">
                <label
                    htmlFor="abort-lineup-reason"
                    className="block text-sm font-medium text-secondary"
                >
                    Reason <span className="text-dim font-normal">(optional)</span>
                </label>
                <span className="text-xs text-muted tabular-nums">
                    {value.length} / {REASON_MAX}
                </span>
            </div>
            <textarea
                id="abort-lineup-reason"
                rows={4}
                maxLength={REASON_MAX}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="Why is this lineup being aborted?"
                className="w-full px-3 py-2 text-sm bg-panel border border-edge rounded-lg text-foreground placeholder:text-dim focus:outline-none focus:ring-2 focus:ring-rose-500/50"
            />
        </div>
    );
}

function ModalFooter({
    onCancel,
    onConfirm,
    isPending,
}: {
    onCancel: () => void;
    onConfirm: () => void;
    isPending: boolean;
}): JSX.Element {
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
                {isPending ? 'Aborting...' : 'Abort Lineup'}
            </button>
        </div>
    );
}

async function submitAbort(
    abort: ReturnType<typeof useAbortLineup>,
    lineupId: number,
    reason: string,
    onClose: () => void,
): Promise<void> {
    const trimmed = reason.trim();
    try {
        await abort.mutateAsync({
            lineupId,
            body: { reason: trimmed === '' ? null : trimmed },
        });
        toast.success('Lineup aborted.');
        onClose();
    } catch (err) {
        toast.error(
            err instanceof Error ? err.message : 'Failed to abort lineup',
        );
    }
}

export function AbortLineupModal({ lineupId, onClose }: Props): JSX.Element {
    const [reason, setReason] = useState('');
    const abort = useAbortLineup();
    return (
        <Modal isOpen={true} onClose={onClose} title="Abort lineup?">
            <div className="space-y-4">
                <p className="text-sm font-medium text-rose-400">
                    This cannot be undone.
                </p>
                <ReasonField value={reason} onChange={setReason} />
                <ModalFooter
                    onCancel={onClose}
                    onConfirm={() =>
                        void submitAbort(abort, lineupId, reason, onClose)
                    }
                    isPending={abort.isPending}
                />
            </div>
        </Modal>
    );
}
