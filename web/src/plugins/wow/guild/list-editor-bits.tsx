/**
 * ROK-1786 — shared bits of the inline list editors (rules, links): the
 * up / down / remove controls and the Save / Cancel footer.
 */
import type { JSX } from 'react';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';

export function ItemControls({ name, index, count, onMove, onRemove }: {
    name: string; index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}): JSX.Element {
    return (
        <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(-1)}>
                <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" iconOnly aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
                <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button variant="destructive-soft" size="sm" iconOnly aria-label={`Remove ${name}`} onClick={onRemove}>
                <TrashIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

export function EditorFooter({ saving, failed, canSave, onCancel, onSave, testId }: {
    saving: boolean; failed: boolean; canSave: boolean; onCancel: () => void; onSave: () => void; testId: string;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center justify-end gap-2">
            {failed && <p role="alert" className="mr-auto text-sm text-danger">Couldn&apos;t save. Check the fields and try again.</p>}
            <Button variant="secondary" onClick={onCancel}>Cancel</Button>
            <Button onClick={onSave} loading={saving} disabled={!canSave} data-testid={testId}>Save</Button>
        </div>
    );
}
