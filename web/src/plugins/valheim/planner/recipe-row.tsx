/**
 * ROK-1899 — one recipe-list row (spec §3.1.3): a ≥44px toggle button with a
 * 28px icon, the name, "×N" for a multi-output craft, "★N" above station
 * level 1 and, while searching, the station as a muted suffix. A short row is
 * greyed (dim name, desaturated icon, an aria-hidden "⊘" as the non-colour
 * cue) and its `aria-description` lists every shortfall; it stays
 * selectable. Selected = the `success` band, `aria-pressed="true"`. Memoised:
 * props are primitives or stable callbacks.
 */
import { memo, type JSX } from 'react';
import { Button } from '../../../components/ui/button';
import { ItemIcon } from '../character/item-icon';
import { resolveItem } from '../character/item-icon.helpers';
import { rowDescription, type CraftRow, type RankedRow } from './crafting.helpers';
import { DiscoveryChip } from './discovery-chip';
import type { PlannerNames } from './use-planner-names';

export interface RecipeRowProps {
    row: RankedRow;
    index: number;
    selected: boolean;
    /** This row holds the list's single tab stop. */
    tabStop: boolean;
    showStation: boolean;
    names: PlannerNames;
    onSelect: (row: CraftRow) => void;
    onFocusIndex: (index: number) => void;
}

function RowIcon({ row, names, short }: { row: CraftRow; names: PlannerNames; short: boolean }): JSX.Element {
    const { prefab, kind } = row.entry;
    const ctx = names.ctxFor(prefab, kind);
    const resolved = { ...resolveItem(prefab, ctx.items, ctx.atlas), label: row.entry.name };
    return (
        <span
            aria-hidden="true"
            className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden [&>*]:scale-[0.875] ${short ? 'opacity-55 grayscale' : ''}`}
        >
            <ItemIcon resolved={resolved} prefab={prefab} ctx={ctx} />
        </span>
    );
}

function rowClass(selected: boolean, short: boolean): string {
    // Button wraps children in a `data-button-label` span: stretch it so icon + name sit left, suffixes right.
    const base =
        'flex min-h-11 w-full items-center gap-2.5 border-l-4 px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-success/80 ' +
        '[&>[data-button-label]]:min-w-0 [&>[data-button-label]]:flex-1 [&>[data-button-label]]:gap-2.5';
    if (selected) return `${base} border-success bg-success/15 font-semibold text-foreground`;
    return `${base} border-transparent hover:bg-overlay ${short ? 'text-dim' : 'text-foreground'}`;
}

function Suffixes({ row, showStation }: { row: CraftRow; showStation: boolean }): JSX.Element {
    const amount = 'amount' in row.cost && typeof row.cost.amount === 'number' ? row.cost.amount : 1;
    const level = row.cost.stationLevel;
    return (
        <>
            {row.entry.discovered === false && <DiscoveryChip />}
            {showStation && <span className="shrink-0 text-xs text-muted">{row.stationLabel}</span>}
            {amount > 1 && <span className="shrink-0 font-mono text-xs text-muted">×{amount}</span>}
            {level > 1 && (
                <span className="shrink-0 font-mono text-[11px] text-muted">
                    <span aria-hidden="true">★{level}</span>
                    <span className="sr-only">station level {level}</span>
                </span>
            )}
        </>
    );
}

function RecipeRowImpl({ row, index, selected, tabStop, showStation, names, onSelect, onFocusIndex }: RecipeRowProps): JSX.Element {
    const short = row.afford.state === 'short';
    return (
        <Button
            variant="bare"
            type="button"
            aria-pressed={selected}
            aria-description={rowDescription(row.afford, (p) => names.nameOf(p, 'item'))}
            tabIndex={tabStop ? 0 : -1}
            data-ri={index}
            data-testid="valheim-craft-row"
            data-prefab={row.entry.prefab}
            data-afford={row.afford.state}
            data-discovered={row.entry.discovered === undefined || row.entry.discovered === null ? undefined : String(row.entry.discovered)}
            className={rowClass(selected, short)}
            onFocus={() => onFocusIndex(index)}
            onClick={() => onSelect(row)}
        >
            <span aria-hidden="true" className="w-3 shrink-0 text-dim">
                {short ? '⊘' : ''}
            </span>
            <RowIcon row={row} names={names} short={short} />
            <span className="min-w-0 flex-1 truncate">{row.entry.name}</span>
            <Suffixes row={row} showStation={showStation} />
        </Button>
    );
}

/** A memoised recipe-list row. */
export const RecipeRow = memo(RecipeRowImpl);
