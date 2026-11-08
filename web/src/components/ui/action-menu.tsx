/**
 * The §4.11 row action menu (extracted from `UserManagementRow.tsx`, ROK-2140):
 * ghost rows, `destructive-soft` for destructive items, `role="menu"` /
 * `role="menuitem"`. Pair the popover with `useMenuDismiss` (`use-menu-dismiss.ts`). `placement="popover"` floats under a `relative` trigger
 * wrapper; `placement="inline"` lays the rows out in place (a BottomSheet body).
 */
import type { JSX } from 'react';
import { Button } from './button';

/** One menu row. `destructive` items render `destructive-soft`; the rest `ghost` (no per-item hue). */
export interface ActionMenuItem { key: string; icon: JSX.Element; label: string; destructive?: boolean; onClick: () => void; }

/**
 * Button centres its label (`justify-center`, no tailwind-merge), so a menu row
 * stretches the label span to the full width instead: its own `inline-flex`
 * then packs icon + text from the left.
 */
const MENU_ITEM_LEFT = '[&>[data-button-label]]:w-full';

const PLACEMENT_CLASS = {
    popover: 'absolute right-0 top-full mt-1 z-10 min-w-[12rem] bg-panel border border-edge rounded-lg shadow-lg p-1',
    inline: '',
} as const;

/** The open menu's rows. */
export function ActionMenuList({ items, placement = 'popover', label }: {
    items: ActionMenuItem[]; placement?: keyof typeof PLACEMENT_CLASS; label?: string;
}): JSX.Element {
    return (
        <div role="menu" aria-label={label} className={`${PLACEMENT_CLASS[placement]} flex flex-col gap-1`}>
            {items.map((it) => (
                <Button key={it.key} role="menuitem" variant={it.destructive ? 'destructive-soft' : 'ghost'} size="sm" fullWidth
                    className={MENU_ITEM_LEFT} onClick={it.onClick}>
                    {it.icon}{it.label}
                </Button>
            ))}
        </div>
    );
}
