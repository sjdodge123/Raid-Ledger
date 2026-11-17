/**
 * ROK-2226 L4b — the `?discussion=1` panel on the event page (spec §7 CTA
 * target, OQ-11). It reads and writes the event thread through the
 * event-scoped routes (`events/:id/discussion/thread` + `/replies`), so a
 * signed-up NON-member — who 403s on the members-only hub forum — can read
 * and reply here. Reuses the forum's message, reply row, composer and
 * "Show more replies"; the root is system-managed, so it has no menu (§5.5).
 * The Discord sync hint and "via Discord" chip are ROK-2208's. Tokens only.
 */
import type { JSX } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { UsersIcon } from '@heroicons/react/24/outline';
import type { EventResponseDto, HubForumThread } from '@raid-ledger/contract';
import { FOCUS_RING } from '../../components/ui/form-classes';
import {
    ForumEventPills,
    ForumLockBar,
} from '../../components/hub/forum/forum-event-header';
import { ForumRootMessage } from '../../components/hub/forum/forum-event-root';
import { ForumReplyComposerView } from '../../components/hub/forum/forum-composer';
import { ForumReplyItemView } from '../../components/hub/forum/forum-thread-items';
import { MoreReplies } from '../../components/hub/forum/forum-thread-view';
import { replyCountLabel } from '../../components/hub/forum/forum-thread.helpers';
import { httpStatusOf } from '../../lib/api/api-error';
import {
    EventDiscussionCard,
    type EventDiscussionCardProps,
} from './EventDiscussionCard';
import {
    DiscussionSignupNote,
    type DiscussionSignup,
} from './event-discussion-card-parts';
import { signedUpLabel } from './event-discussion-labels';
import { discussionOpenFromSearch } from './event-discussion-link';
import {
    eventReplyFailureCopy,
    useCreateEventReply,
    useDeleteEventReply,
    useEventDiscussionThread,
    useUpdateEventReply,
} from './use-event-discussion-thread';

export const DISCUSSION_FORBIDDEN =
    'Only hub members and players signed up for this event can read this discussion.';
export const DISCUSSION_LOAD_FAILED =
    'Couldn’t load this discussion. It may have been removed.';

type PanelEvent = Pick<
    EventResponseDto,
    'id' | 'guildId' | 'hub' | 'signupCount' | 'maxAttendees'
>;

function BackToEvent({ eventId }: { eventId: number }): JSX.Element {
    return (
        <Link
            to={`/events/${eventId}`}
            data-testid="event-discussion-back"
            className={`mb-3 inline-block rounded-sm text-sm font-medium text-success underline-offset-2 hover:underline ${FOCUS_RING}`}
        >
            ← Back to event
        </Link>
    );
}

function ThreadHead({
    event,
    thread,
}: {
    event: PanelEvent;
    thread: HubForumThread;
}): JSX.Element {
    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <h2
                    data-testid="forum-thread-heading"
                    className="text-lg font-semibold text-foreground"
                >
                    {thread.title}
                </h2>
                <ForumEventPills event={thread.event} lock={thread.lock} />
            </div>
            <p
                className="flex items-center gap-1.5 text-sm text-muted"
                data-testid="event-discussion-signed-up"
            >
                <UsersIcon className="h-4 w-4" aria-hidden="true" />
                {signedUpLabel(event)}
            </p>
            {thread.lock != null && <ForumLockBar lock={thread.lock} />}
        </>
    );
}

type ThreadQuery = ReturnType<typeof useEventDiscussionThread>;

/** The loaded replies (edit/delete via the event routes) and "Show more replies". */
function PanelReplies({
    eventId,
    threadId,
    query,
}: {
    eventId: number;
    threadId: number;
    query: ThreadQuery;
}): JSX.Element {
    const update = useUpdateEventReply(eventId);
    const remove = useDeleteEventReply(eventId);
    const replies = query.data?.pages.flatMap((p) => p.replies) ?? [];
    return (
        <>
            <ul className="flex flex-col gap-2">
                {replies.map((r) => (
                    <ForumReplyItemView
                        key={r.id}
                        threadId={threadId}
                        reply={r}
                        highlighted={false}
                        update={update}
                        remove={remove}
                    />
                ))}
            </ul>
            <MoreReplies query={query} />
        </>
    );
}

/** The composer when the viewer may reply; otherwise the sign-up note (none once locked). */
function PanelReplyFoot({
    eventId,
    thread,
    signup,
}: {
    eventId: number;
    thread: HubForumThread;
    signup: DiscussionSignup | undefined;
}): JSX.Element | null {
    const create = useCreateEventReply(eventId);
    const canReply = thread.canReply === true && thread.deleted === null;
    if (canReply) {
        return (
            <ForumReplyComposerView
                threadId={thread.id}
                create={create}
                failureCopy={eventReplyFailureCopy}
            />
        );
    }
    return thread.lock == null ? (
        <DiscussionSignupNote signup={signup} />
    ) : null;
}

interface ThreadProps {
    event: PanelEvent;
    thread: HubForumThread;
    signup: DiscussionSignup | undefined;
    query: ThreadQuery;
}

function PanelThread({
    event,
    thread,
    signup,
    query,
}: ThreadProps): JSX.Element {
    return (
        <div className="flex flex-col gap-3">
            <ThreadHead event={event} thread={thread} />
            {/* ROK-2229: the reply count sits above the opening post, as in the hub thread view. */}
            <p data-testid="forum-reply-count" className="text-xs text-muted">
                {replyCountLabel(thread.replyCount)}
            </p>
            <ForumRootMessage thread={thread} testId="forum-thread-root" />
            <PanelReplies
                eventId={event.id}
                threadId={thread.id}
                query={query}
            />
            <PanelReplyFoot
                eventId={event.id}
                thread={thread}
                signup={signup}
            />
        </div>
    );
}

/**
 * The thread itself failed — its first load or a refetch (a withdrawn signup
 * 403s) — as opposed to a "Show more replies" page. TanStack keeps the last
 * good data on a failed refetch, so the panel must not render it (Codex P2).
 */
function threadFailed(query: ThreadQuery): boolean {
    return query.isError && !query.isFetchNextPageError;
}

/** Skeleton while the thread loads; the 403 / other-failure line when it fails. */
function PanelLoadState({ query }: { query: ThreadQuery }): JSX.Element | null {
    if (query.isPending) {
        return (
            <div
                className="h-32 animate-pulse rounded-lg border border-edge bg-panel"
                aria-busy="true"
                aria-label="Loading discussion"
            />
        );
    }
    if (!threadFailed(query)) return null;
    return (
        <p role="alert" className="text-sm text-danger">
            {httpStatusOf(query.error) === 403
                ? DISCUSSION_FORBIDDEN
                : DISCUSSION_LOAD_FAILED}
        </p>
    );
}

export interface EventDiscussionPanelProps {
    event: PanelEvent;
    signup?: DiscussionSignup | undefined;
}

/** The full event thread on the event page (see file docstring). */
export function EventDiscussionPanel({
    event,
    signup,
}: EventDiscussionPanelProps): JSX.Element {
    const query = useEventDiscussionThread(event.id, true);
    const thread = threadFailed(query) ? undefined : query.data?.pages[0];
    return (
        <section
            className="mb-6 rounded-xl border border-edge bg-surface p-4"
            data-testid="event-discussion-panel"
            aria-label="Event discussion"
        >
            <BackToEvent eventId={event.id} />
            <PanelLoadState query={query} />
            {thread !== undefined && (
                <PanelThread
                    event={event}
                    thread={thread}
                    signup={signup}
                    query={query}
                />
            )}
        </section>
    );
}

export type EventDiscussionSectionProps = EventDiscussionCardProps & {
    event: PanelEvent;
};

/** The card, or the panel in its place while `?discussion=1` is set (logged out / untagged: neither). */
export function EventDiscussionSection(
    props: EventDiscussionSectionProps,
): JSX.Element | null {
    const { search } = useLocation();
    const { event, enabled, signup } = props;
    const tagged = enabled && event.guildId != null && event.hub != null;
    if (tagged && discussionOpenFromSearch(search))
        return <EventDiscussionPanel event={event} signup={signup} />;
    return (
        <EventDiscussionCard event={event} enabled={enabled} signup={signup} />
    );
}
