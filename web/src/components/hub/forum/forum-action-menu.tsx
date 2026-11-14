/**
 * ROK-1175 — the forum's "⋯" action menu (§4.14): the §4.11 `ActionMenuList`
 * dropdown at ≥1024px, the same rows in a `BottomSheet` below. Choosing an
 * item closes the menu first. Renders nothing when the viewer has no action.
 */
import { useCallback, useState, type JSX } from 'react';
import { EllipsisHorizontalIcon, MapPinIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { HubForumCan } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { BottomSheet } from '../../ui/bottom-sheet';
import { ActionMenuList, type ActionMenuItem } from '../../ui/action-menu';
import { useMenuDismiss } from '../../ui/use-menu-dismiss';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

export interface ForumMenuHandlers {
    onEdit?: (() => void) | undefined;
    onDelete?: (() => void) | undefined;
    /** Officers: pin when unpinned, unpin when pinned. */
    onPin?: (() => void) | undefined;
    pinned?: boolean | undefined;
}

const ICON = 'h-4 w-4';

/** The menu rows the server's `can` flags allow (Q5: edit = author inside 24 h). */
export function forumMenuItems(can: HubForumCan, h: ForumMenuHandlers): ActionMenuItem[] {
    const items: ActionMenuItem[] = [];
    if (can.pin && h.onPin) {
        items.push({ key: 'pin', icon: <MapPinIcon className={ICON} aria-hidden="true" />, label: h.pinned ? 'Unpin' : 'Pin', onClick: h.onPin });
    }
    if (can.edit && h.onEdit) items.push({ key: 'edit', icon: <PencilSquareIcon className={ICON} aria-hidden="true" />, label: 'Edit', onClick: h.onEdit });
    if (can.delete && h.onDelete) {
        items.push({ key: 'delete', icon: <TrashIcon className={ICON} aria-hidden="true" />, label: 'Delete', destructive: true, onClick: h.onDelete });
    }
    return items;
}

function closingItems(items: ActionMenuItem[], close: () => void): ActionMenuItem[] {
    return items.map((it) => ({ ...it, onClick: () => { close(); it.onClick(); } }));
}

export interface ForumActionMenuProps { label: string; items: ActionMenuItem[]; testId?: string }

/** The "⋯" trigger + its dropdown (desktop) or bottom sheet (phone). */
export function ForumActionMenu({ label, items, testId = 'forum-actions' }: ForumActionMenuProps): JSX.Element | null {
    const desktop = useMediaQuery(DESKTOP_MQ);
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    const rootRef = useMenuDismiss(open && desktop, close);
    if (items.length === 0) return null;
    const rows = closingItems(items, close);
    return (
        <div ref={rootRef} className="relative">
            <Button variant="ghost" size="sm" iconOnly aria-label={label} aria-haspopup={desktop ? 'menu' : 'dialog'} aria-expanded={open}
                data-testid={testId} onClick={() => setOpen((v) => !v)}>
                <EllipsisHorizontalIcon className={ICON} aria-hidden="true" />
            </Button>
            {desktop
                ? open && <ActionMenuList items={rows} label={label} />
                : <BottomSheet isOpen={open} onClose={close} title={label}><ActionMenuList items={rows} placement="inline" label={label} /></BottomSheet>}
        </div>
    );
}
