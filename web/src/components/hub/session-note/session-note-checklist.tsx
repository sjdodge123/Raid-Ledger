/**
 * ROK-1968 §6.2 — the note's checklist on the card: one shared `Checkbox` row
 * per item (44px label row). Members and editors tick (ruling 1); a viewer
 * without `canTick` sees the boxes disabled. Done rows read `line-through text-muted`.
 */
import type { JSX } from 'react';
import type { HubSessionNoteItem } from '@raid-ledger/contract';
import { Checkbox } from '../../ui/checkbox';

interface Props {
    items: readonly HubSessionNoteItem[];
    canTick: boolean;
    onTick: (itemId: number, done: boolean) => void;
}

export function SessionNoteChecklist({ items, canTick, onTick }: Props): JSX.Element | null {
    if (items.length === 0) return null;
    return (
        <ul className="flex flex-col" aria-label="Checklist">
            {items.map((item) => (
                <li key={item.id}>
                    <Checkbox
                        data-testid={`session-note-item-${item.id}`}
                        checked={item.done}
                        disabled={!canTick}
                        onChange={(e) => onTick(item.id, e.currentTarget.checked)}
                        label={<span className={item.done ? 'line-through text-muted' : undefined}>{item.text}</span>}
                    />
                </li>
            ))}
        </ul>
    );
}
