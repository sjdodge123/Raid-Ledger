import { useState } from 'react';
import type { SeriesScope } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';

interface SeriesScopeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (scope: SeriesScope) => void;
    action: 'edit' | 'delete' | 'cancel';
    isPending?: boolean;
}

const SCOPE_OPTIONS: Array<{ value: SeriesScope; label: string; description: string }> = [
    { value: 'this', label: 'This event only', description: 'Only the selected event will be affected.' },
    { value: 'this_and_following', label: 'This and following events', description: 'This event and all future events in the series.' },
    { value: 'all', label: 'All events in series', description: 'Every event in the recurring series.' },
];

const ACTION_LABELS: Record<string, { title: string; button: string }> = {
    edit: { title: 'Edit Series Event', button: 'Continue' },
    delete: { title: 'Delete Series Event', button: 'Delete' },
    cancel: { title: 'Cancel Series Event', button: 'Cancel Events' },
};

/** Radio option for series scope selection. */
function ScopeOption({ option, selected, onSelect }: {
    option: (typeof SCOPE_OPTIONS)[number]; selected: boolean; onSelect: () => void;
}) {
    return (
        <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selected ? 'border-emerald-500 bg-emerald-500/10' : 'border-edge hover:border-dim'}`}>
            <input type="radio" name="series-scope" checked={selected} onChange={onSelect}
                className="mt-0.5 accent-emerald-500" />
            <div>
                <span className="text-sm font-medium text-foreground">{option.label}</span>
                <p className="text-xs text-muted mt-0.5">{option.description}</p>
            </div>
        </label>
    );
}

/**
 * Modal for selecting series operation scope (Google Calendar-style).
 * Presents three radio options: this / this+following / all.
 */
export function SeriesScopeModal({ isOpen, onClose, onConfirm, action, isPending }: SeriesScopeModalProps) {
    const [selected, setSelected] = useState<SeriesScope>('this');
    const labels = ACTION_LABELS[action];
    const isDanger = action === 'delete' || action === 'cancel';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={labels.title}>
            <div className="space-y-3">
                {SCOPE_OPTIONS.map((opt) => (
                    <ScopeOption key={opt.value} option={opt} selected={selected === opt.value} onSelect={() => setSelected(opt.value)} />
                ))}
                <div className="flex justify-end gap-2 pt-3 border-t border-edge">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
                        Back
                    </button>
                    <button type="button" className={`btn btn-sm ${isDanger ? 'btn-danger' : 'btn-primary'}`}
                        onClick={() => onConfirm(selected)} disabled={isPending}>
                        {isPending ? 'Processing...' : labels.button}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
