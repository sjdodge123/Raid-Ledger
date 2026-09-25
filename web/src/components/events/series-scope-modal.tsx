import { useState } from 'react';
import type { SeriesScope } from '@raid-ledger/contract';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import { RadioGroup, type RadioOption } from '../ui/radio-group';

interface SeriesScopeModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (scope: SeriesScope) => void;
    action: 'edit' | 'delete' | 'cancel';
    isPending?: boolean;
}

const SCOPE_OPTIONS: readonly RadioOption<SeriesScope>[] = [
    { value: 'this', label: 'This event only', description: 'Only the selected event will be affected.' },
    { value: 'this_and_following', label: 'This and following events', description: 'This event and all future events in the series.' },
    { value: 'all', label: 'All events in series', description: 'Every event in the recurring series.' },
];

const ACTION_LABELS: Record<string, { title: string; button: string }> = {
    edit: { title: 'Edit Series Event', button: 'Continue' },
    delete: { title: 'Delete Series Event', button: 'Delete' },
    cancel: { title: 'Cancel Series Event', button: 'Cancel Events' },
};

/**
 * Modal for selecting series operation scope (Google Calendar-style).
 * Presents three list radios: this / this+following / all. A one-shot
 * choice, not a form — there is nothing to lose, so no dirty-close guard.
 */
export function SeriesScopeModal({ isOpen, onClose, onConfirm, action, isPending }: SeriesScopeModalProps) {
    const [selected, setSelected] = useState<SeriesScope>('this');
    const labels = ACTION_LABELS[action];
    const isDanger = action === 'delete' || action === 'cancel';

    const footer = (
        <>
            <Button variant="secondary" size="sm" onClick={onClose}>Back</Button>
            <Button variant={isDanger ? 'destructive' : 'primary'} size="sm"
                loading={isPending} loadingLabel="Processing..." onClick={() => onConfirm(selected)}>
                {labels.button}
            </Button>
        </>
    );

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={labels.title} footer={footer}>
            <RadioGroup label="Apply to" appearance="list" options={SCOPE_OPTIONS}
                value={selected} onChange={setSelected} />
        </Modal>
    );
}
