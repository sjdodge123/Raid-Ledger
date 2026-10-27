/**
 * ROK-1968 §6.4 — the editor's checklist rows: one `Input` per item with
 * move up / move down / remove icon buttons (ruling 10: no drag) and an
 * "Add item" ghost button that hides at the 20-item cap (ruling 7). Every
 * control is the 44px `Button`/`Input` primitive below `lg`.
 */
import type { JSX } from 'react';
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { HUB_SESSION_NOTE_ITEMS_MAX } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { itemError, itemOps, type DraftItem } from './session-note.helpers';

interface RowProps {
    row: DraftItem;
    index: number;
    count: number;
    onChange: (next: (items: DraftItem[]) => DraftItem[]) => void;
}

function ItemRow({ row, index, count, onChange }: RowProps): JSX.Element {
    const n = index + 1;
    const error = row.text === '' ? null : itemError(row.text);
    const errorId = `session-note-item-error-${row.key}`;
    return (
        <li className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
                <Input className="flex-1" value={row.text} aria-label={`Checklist item ${n}`} invalid={error !== null}
                    data-testid={`session-note-item-input-${index}`} placeholder="What needs doing?"
                    {...(error === null ? {} : { 'aria-describedby': errorId })}
                    onChange={(e) => { const text = e.target.value; onChange((items) => itemOps.text(items, index, text)); }} />
                <Button variant="ghost" iconOnly aria-label={`Move item ${n} up`} disabled={index === 0}
                    onClick={() => onChange((items) => itemOps.move(items, index, -1))}>
                    <ChevronUpIcon className="h-5 w-5" aria-hidden="true" />
                </Button>
                <Button variant="ghost" iconOnly aria-label={`Move item ${n} down`} disabled={index === count - 1}
                    onClick={() => onChange((items) => itemOps.move(items, index, 1))}>
                    <ChevronDownIcon className="h-5 w-5" aria-hidden="true" />
                </Button>
                <Button variant="ghost" iconOnly aria-label={`Remove item ${n}`} data-testid={`session-note-remove-item-${index}`}
                    onClick={() => onChange((items) => itemOps.remove(items, index))}>
                    <XMarkIcon className="h-5 w-5" aria-hidden="true" />
                </Button>
            </div>
            {error !== null && <p id={errorId} className="text-xs text-danger">{error}</p>}
        </li>
    );
}

export interface SessionNoteItemsEditorProps {
    items: DraftItem[];
    onChange: (next: (items: DraftItem[]) => DraftItem[]) => void;
}

export function SessionNoteItemsEditor({ items, onChange }: SessionNoteItemsEditorProps): JSX.Element {
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">
                Checklist <span className="text-muted">({items.length} of {HUB_SESSION_NOTE_ITEMS_MAX})</span>
            </legend>
            {items.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {items.map((row, i) => <ItemRow key={row.key} row={row} index={i} count={items.length} onChange={onChange} />)}
                </ul>
            )}
            {items.length < HUB_SESSION_NOTE_ITEMS_MAX && (
                <div>
                    <Button variant="ghost" size="sm" data-testid="session-note-add-item" onClick={() => onChange(itemOps.add)}>
                        <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add item
                    </Button>
                </div>
            )}
        </fieldset>
    );
}
