/**
 * ROK-2229 — the opening post of an event thread, rendered client-side so the
 * date reads in the viewer's timezone: a **Raid Ledger** byline (the app's
 * brand mark, `/favicon.svg`; initials if it fails to load) and the
 * "Discussion for …" sentence. Non-event threads keep the author byline and
 * the stored markdown body (`forum-message.tsx`). Tokens only.
 */
import type { JSX } from 'react';
import type { HubForumThread, HubForumThreadEvent } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { eventStartLabel } from './forum-event-format';
import { ForumMessage, type ForumMessageProps } from './forum-message';
import { forumAgo, isEventThread } from './forum-thread.helpers';

/** The app's brand mark — the same svg the browser tab shows. */
const BRAND_MARK_URL = '/favicon.svg';

/** "Raid Ledger · Created when the event was scheduled · 4 d ago". */
export function EventRootByline({ createdAt }: { createdAt: string }): JSX.Element {
    return (
        <div className="flex min-w-0 items-center gap-2" data-testid="forum-event-root-byline">
            <AvatarWithFallback username="Raid Ledger" avatarUrl={BRAND_MARK_URL} sizeClassName="h-8 w-8" alt="" />
            <p className="min-w-0 text-sm">
                <span className="font-semibold text-foreground">Raid Ledger</span>
                <span className="block text-xs text-dim">Created when the event was scheduled · {forumAgo(createdAt)}</span>
            </p>
        </div>
    );
}

/** "Discussion for **Molten Core**, Sat 22 Nov 19:00. Signed-up players (bench included) can post here." */
export function EventRootBody({ event }: { event: HubForumThreadEvent }): JSX.Element {
    return (
        <p data-testid="forum-thread-root-body" className="text-sm text-secondary">
            Discussion for <strong className="font-semibold text-foreground">{event.title}</strong>, {eventStartLabel(event.startTime)}.
            {' '}Signed-up players (bench included) can post here.
        </p>
    );
}

export type ForumRootMessageProps = Omit<ForumMessageProps, 'message' | 'byline' | 'body'> & { thread: HubForumThread };

/**
 * A thread's opening post, shared by the hub thread view and the event-page
 * panel: an event thread gets the Raid Ledger byline and (while its event
 * exists) the client-rendered body; any other thread is a plain `ForumMessage`.
 */
export function ForumRootMessage({ thread, ...rest }: ForumRootMessageProps): JSX.Element {
    const byline = isEventThread(thread) ? { byline: <EventRootByline createdAt={thread.createdAt} /> } : {};
    const body = thread.event != null ? { body: <EventRootBody event={thread.event} /> } : {};
    return <ForumMessage message={thread} {...rest} {...byline} {...body} />;
}
