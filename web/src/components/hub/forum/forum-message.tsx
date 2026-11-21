/**
 * ROK-1175 — one forum message (the thread's root or a reply): avatar, name,
 * time, the "Edited" mark, the markdown body, and the caller's "⋯" menu. A
 * removed message shows only its placeholder, never its text (AC6, Q8).
 * `PostByline` takes a whole `HubPost`, so this keeps its own thin byline.
 */
import { useEffect, useRef, type JSX, type ReactNode, type RefObject } from 'react';
import type { HubForumReply } from '@raid-ledger/contract';
import { MarkdownBlock } from '../../ui/markdown-block';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { Pill } from '../hub-bits';
import { forumByline } from './forum-byline';
import { forumAgo, forumDeletedLabel } from './forum-thread.helpers';

/** The fields a root and a reply share. */
export type ForumMessageData = Pick<HubForumReply, 'author' | 'body' | 'createdAt' | 'editedAt' | 'deleted' | 'source' | 'discordAuthor'>;

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
    /** Replaces the author byline (an event thread's root shows Raid Ledger, ROK-2229). */
    byline?: ReactNode;
    /** Replaces the stored markdown body (an event thread's root renders client-side, ROK-2229). */
    body?: ReactNode;
}

function Byline({ message }: { message: ForumMessageData }): JSX.Element {
    const { name, avatarUrl, viaDiscord } = forumByline(message);
    return (
        <div className="flex min-w-0 items-center gap-2">
            <AvatarWithFallback username={name} avatarUrl={avatarUrl} sizeClassName="h-8 w-8" alt="" />
            <p className="min-w-0 text-sm">
                <span className="font-semibold text-foreground">{name}</span>
                {viaDiscord && <> <Pill title="Posted from Discord">via Discord</Pill></>}
                <span className="block text-xs text-dim">
                    {forumAgo(message.createdAt)}
                    {message.editedAt !== null && <span data-testid="forum-edited"> · Edited</span>}
                </span>
            </p>
        </div>
    );
}

/** The `?reply=<id>` target scrolls into view once it mounts (same as Posts' `post-item.tsx`). */
export function useScrollOnce(highlighted: boolean): RefObject<HTMLElement | null> {
    const ref = useRef<HTMLElement>(null);
    useEffect(() => {
        if (highlighted) ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, [highlighted]);
    return ref;
}

/** A root or reply (see file docstring). */
export function ForumMessage({ message, testId, menu, editor, anchorId, highlighted = false, byline, body }: ForumMessageProps): JSX.Element {
    const ref = useScrollOnce(highlighted);
    if (message.deleted !== null) {
        return (
            <article ref={ref} id={anchorId} data-testid={testId} aria-current={highlighted ? 'true' : undefined} className="rounded-lg border border-dashed border-edge px-4 py-3 text-sm text-muted">
                {forumDeletedLabel(message.deleted)}
            </article>
        );
    }
    const ring = highlighted ? 'border-success ring-1 ring-success' : 'border-edge';
    return (
        <article ref={ref} id={anchorId} data-testid={testId} aria-current={highlighted ? 'true' : undefined}
            className={`scroll-mt-4 rounded-lg border bg-surface p-4 ${ring}`}>
            <div className="mb-2 flex items-start justify-between gap-2">
                {byline ?? <Byline message={message} />}
                {menu}
            </div>
            {editor ?? body ?? <MarkdownBlock text={message.body} className="text-sm text-secondary" testId={`${testId}-body`} />}
        </article>
    );
}
