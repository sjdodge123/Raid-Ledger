/**
 * ROK-1175 — the stateful thread root and reply: each owns its read / edit /
 * delete mode, builds its "⋯" menu from the server's `can` flags (pin on the
 * root only, officers), and runs its own mutation. Every write refetches the
 * forum cache (`use-hub-forum.ts`), so 204s re-render from the server.
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UseMutationResult } from '@tanstack/react-query';
import type { HubForumReply, HubForumThread } from '@raid-ledger/contract';
import { ForumActionMenu } from './forum-action-menu';
import { forumMenuItems } from './forum-menu-items';
import { ForumMessageEditor } from './forum-composer';
import { ForumDeleteConfirm } from './forum-delete-confirm';
import { ForumMessage } from './forum-message';
import { forumThreadHref } from './forum-link';
import { ForumRootMessage } from './forum-event-root';
import { ForumSignupLine } from './forum-signup-line';
import {
    useDeleteForumReply, useDeleteForumThread, useSetForumThreadPin, useUpdateForumReply, useUpdateForumThread,
    type ReplyDeleteVars, type ReplyEditVars,
} from './use-hub-forum';

type Mode = 'read' | 'edit' | 'delete';

/** The root's mode; a list row's Edit (`&edit=1`) starts in the editor, and leaving it drops the flag from the URL. */
function useRootMode(threadId: number, startEditing: boolean, canEdit: boolean): [Mode, (m: Mode) => void] {
    const navigate = useNavigate();
    const fromRow = startEditing && canEdit;
    const [mode, setMode] = useState<Mode>(fromRow ? 'edit' : 'read');
    const change = (m: Mode): void => {
        setMode(m);
        if (fromRow && m !== 'edit') void navigate(forumThreadHref(threadId), { replace: true });
    };
    return [mode, change];
}

export interface ForumThreadRootProps { guildId: number; thread: HubForumThread; startEditing?: boolean }

/** The thread's opening message + its menu (edit, delete, pin/unpin). */
export function ForumThreadRoot({ guildId, thread, startEditing = false }: ForumThreadRootProps): JSX.Element {
    const [mode, setMode] = useRootMode(thread.id, startEditing, thread.can.edit);
    const update = useUpdateForumThread(guildId);
    const remove = useDeleteForumThread(guildId);
    const pin = useSetForumThreadPin(guildId);
    const pinned = thread.pinnedAt !== null;
    const items = forumMenuItems(thread.can, {
        onEdit: () => setMode('edit'), onDelete: () => setMode('delete'),
        onPin: () => pin.mutate({ threadId: thread.id, pinned: !pinned }), pinned,
    });
    const editor = mode === 'edit' ? (
        <ForumMessageEditor title={thread.title} body={thread.body} pending={update.isPending} failed={update.error}
            onCancel={() => setMode('read')} onSave={(input) => update.mutate({ threadId: thread.id, input }, { onSuccess: () => setMode('read') })} />
    ) : undefined;
    return (
        <>
            <ForumRootMessage thread={thread} testId="forum-thread-root" editor={editor}
                menu={<ForumActionMenu label="Thread actions" items={items} testId="forum-thread-actions" />} />
            <ForumDeleteConfirm what="thread" isOpen={mode === 'delete'} pending={remove.isPending} failed={remove.isError}
                onClose={() => setMode('read')} onConfirm={() => remove.mutate(thread.id, { onSuccess: () => setMode('read') })} />
        </>
    );
}

export interface ForumReplyItemProps { guildId: number; threadId: number; reply: HubForumReply; highlighted: boolean }

/** The two reply writes a reply row runs; the hub routes by default, the event routes on the event page (ROK-2226). */
export interface ForumReplyWrites {
    update: UseMutationResult<HubForumReply, Error, ReplyEditVars>;
    remove: UseMutationResult<void, Error, ReplyDeleteVars>;
}

/** One reply + its menu (edit for the author inside 24 h, delete for author/officer). */
export function ForumReplyItem({ guildId, ...rest }: ForumReplyItemProps): JSX.Element {
    const update = useUpdateForumReply(guildId);
    const remove = useDeleteForumReply(guildId);
    return <ForumReplyItemView {...rest} update={update} remove={remove} />;
}

export type ForumReplyItemViewProps = Omit<ForumReplyItemProps, 'guildId'> & ForumReplyWrites;

/** The reply row over whichever `ForumReplyWrites` the caller hands it; a signup line (ROK-2274) or a copied-chat header (ROK-2297) gets the muted system row. */
export function ForumReplyItemView(props: ForumReplyItemViewProps): JSX.Element {
    const { threadId, reply, highlighted, remove } = props;
    if (reply.kind === 'signup_line' || reply.kind === 'copy_header') return <ForumSignupLine threadId={threadId} reply={reply} highlighted={highlighted} remove={remove} />;
    return <ForumPlainReply {...props} />;
}

/** A member's reply: byline, body, edit/delete menu. */
function ForumPlainReply({ threadId, reply, highlighted, update, remove }: ForumReplyItemViewProps): JSX.Element {
    const [mode, setMode] = useState<Mode>('read');
    const items = forumMenuItems(reply.can, { onEdit: () => setMode('edit'), onDelete: () => setMode('delete') });
    const ids = { threadId, replyId: reply.id };
    const editor = mode === 'edit' ? (
        <ForumMessageEditor body={reply.body} pending={update.isPending} failed={update.error} onCancel={() => setMode('read')}
            onSave={({ body }) => update.mutate({ ...ids, body }, { onSuccess: () => setMode('read') })} />
    ) : undefined;
    return (
        <li>
            <ForumMessage message={reply} testId="forum-reply" editor={editor} anchorId={`forum-reply-${reply.id}`} highlighted={highlighted}
                menu={<ForumActionMenu label="Reply actions" items={items} testId="forum-reply-actions" />} />
            <ForumDeleteConfirm what="reply" isOpen={mode === 'delete'} pending={remove.isPending} failed={remove.isError}
                onClose={() => setMode('read')} onConfirm={() => remove.mutate(ids, { onSuccess: () => setMode('read') })} />
        </li>
    );
}
