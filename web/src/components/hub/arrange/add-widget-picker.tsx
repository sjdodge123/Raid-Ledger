/**
 * ROK-1918 L5 — "Add a widget" (mockup frames 3–4): the opt-in widgets this
 * hub can show that are not on the Overview (`resolveHubLayout(...).available`,
 * less anything already added in the draft). `Modal` at ≥1024px, `BottomSheet`
 * below — the shared overlay split (docs/design-system.md §4.4). Hidden
 * default-on widgets are not listed: they stay dimmed in the list (Q2 A).
 */
import type { JSX } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { StatusChip } from '../../ui/status-chip';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import type { HubLayoutEntry } from '../layout/resolve-hub-layout';

const TITLE = 'Add a widget';

export interface AddWidgetPickerProps {
    isOpen: boolean;
    onClose: () => void;
    options: readonly HubLayoutEntry[];
    onAdd: (entry: HubLayoutEntry) => void;
}

function PickerItem({ entry, onAdd }: { entry: HubLayoutEntry; onAdd: (entry: HubLayoutEntry) => void }): JSX.Element {
    return (
        <li className="flex items-start gap-3 py-3" data-testid={`add-widget-option-${entry.id}`}>
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{entry.title}</p>
                {entry.description !== undefined && <p className="text-xs text-muted">{entry.description}</p>}
                {entry.audience !== 'everyone' && (
                    <StatusChip tone="warning" title={`Shown to ${entry.audience} only`} className="mt-1">
                        {entry.audience === 'members' ? 'Members only' : 'Editors only'}
                    </StatusChip>
                )}
            </div>
            <Button variant="secondary" size="sm" aria-label={`Add ${entry.title}`} onClick={() => onAdd(entry)}>
                <PlusIcon className="h-4 w-4" aria-hidden="true" />Add
            </Button>
        </li>
    );
}

function PickerBody({ options, onAdd }: Pick<AddWidgetPickerProps, 'options' | 'onAdd'>): JSX.Element {
    if (options.length === 0) {
        return <p className="text-sm text-muted" data-testid="add-widget-empty">Every widget this hub offers is already on the Overview.</p>;
    }
    return (
        <ul className="divide-y divide-edge" data-testid="add-widget-list">
            {options.map((e) => <PickerItem key={e.id} entry={e} onAdd={onAdd} />)}
        </ul>
    );
}

export function AddWidgetPicker({ isOpen, onClose, options, onAdd }: AddWidgetPickerProps): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const body = <PickerBody options={options} onAdd={onAdd} />;
    if (desktop) {
        return <Modal isOpen={isOpen} onClose={onClose} title={TITLE} maxWidth="max-w-lg">{body}</Modal>;
    }
    return <BottomSheet isOpen={isOpen} onClose={onClose} title={TITLE}>{body}</BottomSheet>;
}
