/**
 * ROK-1175 — one thread in the Forum list: a §4.2 clickable card whose whole
 * frame opens the thread through a `StretchedAction`; the row's ⋯ menu
 * (`forum-row-actions.tsx`) is a later, `relative` control that paints above it. A removed thread renders its placeholder only.
 */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { HubForumThreadSummary } from '@raid-ledger/contract';
import { StretchedAction } from '../../ui/stretched-action';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { Pill } from '../hub-bits';
import { CalendarIcon } from '@heroicons/react/24/outline';
import { ForumEventPills } from './forum-event-header';
import { forumThreadTitle } from './forum-event-format';
import { forumThreadHref } from './forum-link';
import { ForumRowActions } from './forum-row-actions';
import { forumByline, type ForumByline } from './forum-byline';
import { forumDeletedLabel, forumRowMeta, forumRowPreview, isEventThread, replyCountLabel, type ForumViewer } from './forum-thread.helpers';

export interface ForumThreadRowProps { guildId: number; thread: HubForumThreadSummary; viewer: ForumViewer }

function RemovedRow({ thread, open }: { thread: HubForumThreadSummary; open: () => void }): JSX.Element {
    const label = forumDeletedLabel(thread.deleted ?? 'author');
    return (
        <li data-testid="forum-thread-row" className="relative rounded-lg border border-dashed border-edge px-4 py-3 text-sm text-muted">
            <StretchedAction label={`Open removed thread (${label})`} onClick={open} />
            {label} · {replyCountLabel(thread.replyCount)} {thread.replyCount === 1 ? 'is' : 'are'} still readable
        </li>
    );
}

/** The row's avatar: the author (or Discord guest, ROK-2208), or — on an event thread — a calendar mark (ROK-2229). */
function RowAvatar({ thread, byline }: { thread: HubForumThreadSummary; byline: ForumByline }): JSX.Element {
    if (isEventThread(thread)) {
        return (
            <span data-testid="forum-thread-event-avatar" className="flex h-9 w-9 items-center justify-center rounded-full bg-overlay text-muted">
                <CalendarIcon className="h-4 w-4" aria-hidden="true" />
            </span>
        );
    }
    return <AvatarWithFallback username={byline.name} avatarUrl={byline.avatarUrl} sizeClassName="h-9 w-9" alt="" />;
}

/** A Forum list row (see file docstring). */
export function ForumThreadRow({ guildId, thread, viewer }: ForumThreadRowProps): JSX.Element {
    const navigate = useNavigate();
    const open = (): void => { void navigate(forumThreadHref(thread.id)); };
    if (thread.deleted !== null) return <RemovedRow thread={thread} open={open} />;
    const pinned = thread.pinnedAt !== null;
    const byline = forumByline(thread);
    const frame = pinned ? 'border-success/40' : 'border-edge hover:border-edge-strong';
    const title = forumThreadTitle(thread);
    return (
        <li data-testid="forum-thread-row"
            className={`relative grid cursor-pointer grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg border bg-surface px-4 py-3 transition-colors ${frame}`}>
            <StretchedAction label={`Open thread: ${title}`} onClick={open} />
            <RowAvatar thread={thread} byline={byline} />
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                    <span data-testid="forum-thread-title" className="max-w-full truncate font-semibold text-foreground">{title}</span>
                    {pinned && <Pill tone="success">Pinned</Pill>}
                    {byline.viaDiscord && <Pill title="Posted from Discord">via Discord</Pill>}
                    <ForumEventPills event={thread.event} lock={thread.lock} />
                </div>
                <p className="mt-0.5 truncate text-sm text-secondary">{forumRowPreview(thread)}</p>
                <p className="mt-1 text-xs text-muted">{forumRowMeta(thread)}</p>
            </div>
            <div className="relative flex items-start gap-1">
                <span className="whitespace-nowrap pt-1 text-right text-xs text-muted">{replyCountLabel(thread.replyCount)}</span>
                <ForumRowActions guildId={guildId} thread={thread} viewer={viewer} />
            </div>
        </li>
    );
}
