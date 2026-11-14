/** ROK-1175 — the forum "⋯" menu rows, from the server's `can` flags. */
import { MapPinIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { HubForumCan } from '@raid-ledger/contract';
import type { ActionMenuItem } from '../../ui/action-menu';

const ICON = 'h-4 w-4';

export interface ForumMenuHandlers {
    onEdit?: (() => void) | undefined;
    onDelete?: (() => void) | undefined;
    /** Officers: pin when unpinned, unpin when pinned. */
    onPin?: (() => void) | undefined;
    pinned?: boolean | undefined;
}

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
