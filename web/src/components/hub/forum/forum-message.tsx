/**
 * ROK-1175 — one forum message (the thread's root or a reply): avatar, name,
 * time, the "Edited" mark, the markdown body, and the caller's "⋯" menu. A
 * removed message shows only its placeholder, never its text (AC6, Q8).
 * `PostByline` takes a whole `HubPost`, so this keeps its own thin byline.
 */
import type { JSX, ReactNode } from 'react';
import type { HubForumReply } from '@raid-ledger/contract';
import { MarkdownBlock } from '../../ui/markdown-block';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { syncedAgo } from '../../../lib/synced-ago';
import { forumAuthorName, forumDeletedLabel } from './forum-thread.helpers';

/** The fields a root and a reply share. */
export type ForumMessageData = Pick<HubForumReply, 'author' | 'body' | 'createdAt' | 'editedAt' | 'deleted'>;

export interface ForumMessageProps {
    message: ForumMessageData;
    testId: string;
    /** The "⋯" menu (omitted for visitors and removed messages). */
    menu?: ReactNode;
    /** Replaces the body while the author edits. */
    editor?: ReactNode;
    /** DOM id for `?reply=<id>` deep links. */
    anchorId?: string | undefined;
    highlighted?: boolean;
}

function Byline({ message }: { message: ForumMessageData }): JSX.Element {
    const name = forumAuthorName(message.author);
    return (
        <div className="flex min-w-0 items-center gap-2">
            <AvatarWithFallback username={name} avatarUrl={message.author?.avatarUrl ?? null} sizeClassName="h-8 w-8" alt="" />
            <p className="min-w-0 text-sm">
                <span className="font-semibold text-foreground">{name}</span>
                <span className="block text-xs text-dim">
                    {syncedAgo(message.createdAt, Date.now())}
                    {message.editedAt !== null && <span data-testid="forum-edited"> · Edited</span>}
                </span>
            </p>
        </div>
    );
}

/** A root or reply (see file docstring). */
export function ForumMessage({ message, testId, menu, editor, anchorId, highlighted = false }: ForumMessageProps): JSX.Element {
    if (message.deleted !== null) {
        return (
            <article id={anchorId} data-testid={testId} className="rounded-lg border border-dashed border-edge px-4 py-3 text-sm text-muted">
                {forumDeletedLabel(message.deleted)}
            </article>
        );
    }
    const ring = highlighted ? 'border-success ring-1 ring-success' : 'border-edge';
    return (
        <article id={anchorId} data-testid={testId} aria-current={highlighted ? 'true' : undefined}
            className={`scroll-mt-4 rounded-lg border bg-surface p-4 ${ring}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
                <Byline message={message} />
                {menu}
            </div>
            {editor ?? <MarkdownBlock text={message.body} className="text-sm text-secondary" testId={`${testId}-body`} />}
        </article>
    );
}
