/**
 * ROK-1968 §6.2 — the note's checklist on the card: one shared `Checkbox` row
 * per item (44px label row). Members and editors tick (ruling 1); a viewer
 * without `canTick` sees the boxes disabled. Done rows read `line-through text-muted`.
 *
 * The box is controlled by the query cache, but the optimistic cache write lands
 * a few ticks after the click (onMutate's awaits + TanStack's setTimeout(0)
 * notify), so a cache-only box snaps back to its old state when the click
 * returns. A per-item `clicked` value bridges that gap: it holds the clicked
 * state only while the cache still hands back the SAME item object, and is
 * dropped for good the moment the optimistic write replaces it — so a later
 * rollback (which restores the pre-click object) shows the cache, not the click.
 */
import { useState, type JSX } from 'react';
import type { HubSessionNoteItem } from '@raid-ledger/contract';
import { Checkbox } from '../../ui/checkbox';

interface Props {
    items: readonly HubSessionNoteItem[];
    canTick: boolean;
    onTick: (itemId: number, done: boolean) => void;
}

interface Clicked { done: boolean; source: HubSessionNoteItem }
type ClickedMap = ReadonlyMap<number, Clicked>;

/** Drops every click whose item the cache has since replaced; the same map when nothing is stale. */
function pruneClicked(clicked: ClickedMap, items: readonly HubSessionNoteItem[]): ClickedMap {
    const live = [...clicked].filter(([id, c]) => items.some((item) => item.id === id && item === c.source));
    return live.length === clicked.size ? clicked : new Map(live);
}

export function SessionNoteChecklist({ items, canTick, onTick }: Props): JSX.Element | null {
    const [clicked, setClicked] = useState<ClickedMap>(new Map());
    const live = pruneClicked(clicked, items);
    if (live !== clicked) setClicked(live); // adjust-state-during-render: React re-renders before commit
    if (items.length === 0) return null;
    const shown = (item: HubSessionNoteItem): boolean => live.get(item.id)?.done ?? item.done;
    const tick = (item: HubSessionNoteItem, done: boolean): void => {
        setClicked((prev) => new Map(prev).set(item.id, { done, source: item }));
        onTick(item.id, done);
    };
    return (
        <ul className="flex flex-col" aria-label="Checklist">
            {items.map((item) => {
                const done = shown(item);
                return (
                    <li key={item.id}>
                        <Checkbox
                            data-testid={`session-note-item-${item.id}`}
                            checked={done}
                            disabled={!canTick}
                            onChange={(e) => tick(item, e.currentTarget.checked)}
                            label={<span className={done ? 'line-through text-muted' : undefined}>{item.text}</span>}
                        />
                    </li>
                );
            })}
        </ul>
    );
}
