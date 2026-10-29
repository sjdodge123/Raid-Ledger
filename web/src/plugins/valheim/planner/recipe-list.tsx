/**
 * ROK-1899 — the crafting window's inset recipe list (spec §3.1.3, §3.5): a
 * `bg-surface` well with its own scroll, one tab stop (`useRovingList`), the
 * rows already ranked can → short → unknown by `sortRows`. No virtualization:
 * ≤ ~150 rows per station, ≤ ~900 while searching. `aria-busy` while stock
 * loads (rows stay neutral, no grey flash); `empty` renders in place of the
 * rows (the window picks the copy from `emptyReason`).
 */
import type { JSX, ReactNode } from 'react';
import type { CraftRow, RankedRow } from './crafting.helpers';
import { rowKey } from './use-crafting-window';
import { RecipeRow } from './recipe-row';
import { useRovingList } from './use-roving-list';
import type { PlannerNames } from './use-planner-names';

export interface RecipeListProps {
    /** The list's accessible name ("Workbench recipes", "Matches from every station"). */
    label: string;
    rows: readonly RankedRow[];
    selectedKey: string | null;
    onSelect: (row: CraftRow) => void;
    names: PlannerNames;
    /** Searching: each row adds its station as a muted suffix. */
    showStation: boolean;
    /** Stock is loading. */
    busy?: boolean;
    /** Shown inside the well when there are no rows. */
    empty?: ReactNode;
    /** Sizing for the scroll well (default `max-h-[32rem]`). */
    className?: string;
}

/** The recipe list. */
export function RecipeList(props: RecipeListProps): JSX.Element {
    const { label, rows, selectedKey, onSelect, names, showStation, busy = false, empty, className } = props;
    const selectedIndex = selectedKey === null ? -1 : rows.findIndex((r) => rowKey(r) === selectedKey);
    const roving = useRovingList(rows.length, selectedIndex);
    return (
        <div className={`overflow-y-auto rounded-md border border-edge-subtle bg-surface ${className ?? 'max-h-[32rem]'}`}>
            {rows.length === 0 && empty !== undefined ? (
                <div className="p-4">{empty}</div>
            ) : (
                <ul aria-label={label} aria-busy={busy || undefined} className="py-1" onKeyDown={roving.onKeyDown}>
                    {rows.map((row, i) => (
                        <li key={rowKey(row)}>
                            <RecipeRow
                                row={row}
                                index={i}
                                selected={i === selectedIndex}
                                tabStop={i === roving.stop}
                                showStation={showStation}
                                names={names}
                                onSelect={onSelect}
                                onFocusIndex={roving.focusIndex}
                            />
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
