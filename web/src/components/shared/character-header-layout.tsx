/**
 * ROK-2140 — pieces the character detail header shares between core and the
 * game plugins that fill its slots: the layout hint core passes in slot
 * context, the icon-over-label action tile, and the phone stat tile.
 */
import type { JSX, ReactNode } from 'react';

/** `phone` = below `sm` (Option B profile card); `desktop` = the ≥ `sm` row. */
export type CharacterHeaderLayout = 'phone' | 'desktop';

/**
 * Applied to a `Button variant="secondary" fullWidth`: stacks the icon over
 * the label in a 60px tile (Option B's three-up Sync / Import / More row).
 * Button has no tailwind-merge, so the stacking targets its label span.
 */
export const ACTION_TILE_CLASS = 'min-h-[60px] text-xs [&>[data-button-label]]:flex-col [&>[data-button-label]]:gap-1';

/** One tile of the phone header's stat strip: a big value over a muted label. */
export function StatTile({ value, label, valueClassName = 'text-foreground' }: {
    value: ReactNode; label: string; valueClassName?: string;
}): JSX.Element {
    return (
        <div data-testid="character-stat-tile" className="bg-surface rounded-lg px-1 py-2">
            <div className={`text-lg leading-6 font-bold ${valueClassName}`}>{value}</div>
            <div className="text-xs text-muted">{label}</div>
        </div>
    );
}
