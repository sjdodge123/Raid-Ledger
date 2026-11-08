/**
 * ROK-2140 — where the character page puts its admin actions (Change owner,
 * Unlink): a "⋯" row action menu at ≥ sm (§4.11 `ActionMenuList`), and the
 * Option B "More" tile opening a `BottomSheet` on phones. The dialogs the
 * items open live in the caller, so closing the menu never unmounts them.
 */
import { useCallback, useState, type JSX } from 'react';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../components/ui/button';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { ActionMenuList, useMenuDismiss, type ActionMenuItem } from '../../../components/ui/action-menu';
import { ACTION_TILE_CLASS, type CharacterHeaderLayout } from '../../../components/shared/character-header-layout';

interface OverflowProps { name: string; items: ActionMenuItem[] }

/** Wraps each item so choosing it closes the menu/sheet first. */
function closingItems(items: ActionMenuItem[], close: () => void): ActionMenuItem[] {
    return items.map((it) => ({ ...it, onClick: () => { close(); it.onClick(); } }));
}

function OverflowMenu({ name, items }: OverflowProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    const rootRef = useMenuDismiss(open, close);
    return (
        <div ref={rootRef} className="relative">
            <Button variant="secondary" size="sm" iconOnly aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}>
                <EllipsisHorizontalIcon className="w-4 h-4" aria-hidden="true" />
            </Button>
            {open && <ActionMenuList items={closingItems(items, close)} />}
        </div>
    );
}

function MoreSheet({ name, items }: OverflowProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    return (
        <>
            <Button variant="secondary" size="sm" fullWidth className={ACTION_TILE_CLASS} onClick={() => setOpen(true)}>
                <EllipsisHorizontalIcon className="w-5 h-5" aria-hidden="true" />
                More
            </Button>
            <BottomSheet isOpen={open} onClose={close} title={name}>
                <ActionMenuList items={closingItems(items, close)} placement="inline" label={`Actions for ${name}`} />
            </BottomSheet>
        </>
    );
}

/** The admin overflow for the character header: ⋯ menu (≥ sm) or More + sheet (phone). */
export function CharacterAdminOverflow({ layout, ...props }: OverflowProps & { layout: CharacterHeaderLayout }): JSX.Element {
    return layout === 'phone' ? <MoreSheet {...props} /> : <OverflowMenu {...props} />;
}
