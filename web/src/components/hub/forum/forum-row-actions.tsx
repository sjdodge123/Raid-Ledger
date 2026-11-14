/**
 * ROK-1175 — a Forum list row's "⋯" menu (§4.14, the thread view's
 * `ForumActionMenu` + `forumMenuItems`): Pin/Unpin and Delete run here (Delete
 * through `ForumDeleteConfirm`); Edit opens the thread with its opening
 * message already in the editor (`?thread=<id>&edit=1#forum`). Rights come
 * from `forumRowCan` — no menu when the viewer has none.
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HubForumThreadSummary } from '@raid-ledger/contract';
import { ForumActionMenu } from './forum-action-menu';
import { ForumDeleteConfirm } from './forum-delete-confirm';
import { forumMenuItems } from './forum-menu-items';
import { forumThreadEditHref } from './forum-link';
import { forumRowCan, type ForumViewer } from './forum-thread.helpers';
import { useDeleteForumThread, useSetForumThreadPin } from './use-hub-forum';

export interface ForumRowActionsProps { guildId: number; thread: HubForumThreadSummary; viewer: ForumViewer }

/** The row's raised "⋯" control + its delete confirm (see file docstring). */
export function ForumRowActions({ guildId, thread, viewer }: ForumRowActionsProps): JSX.Element | null {
    const navigate = useNavigate();
    const [confirming, setConfirming] = useState(false);
    const remove = useDeleteForumThread(guildId);
    const pin = useSetForumThreadPin(guildId);
    const pinned = thread.pinnedAt !== null;
    const items = forumMenuItems(forumRowCan(thread, viewer), {
        onEdit: () => { void navigate(forumThreadEditHref(thread.id)); },
        onDelete: () => setConfirming(true),
        onPin: () => pin.mutate({ threadId: thread.id, pinned: !pinned }),
        pinned,
    });
    if (items.length === 0) return null;
    return (
        <>
            <ForumActionMenu label={`Actions for ${thread.title}`} items={items} testId="forum-row-actions" />
            <ForumDeleteConfirm what="thread" isOpen={confirming} pending={remove.isPending} failed={remove.isError}
                onClose={() => setConfirming(false)} onConfirm={() => remove.mutate(thread.id, { onSuccess: () => setConfirming(false) })} />
        </>
    );
}
