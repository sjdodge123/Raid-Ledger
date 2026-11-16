/**
 * ROK-2226 — the "Discussion" card on the event page (approved mockup, Q1:
 * after the Signups roster, before Activity). It previews the hub-tagged
 * event's forum thread: up to three newest replies (avatar, name, time, body
 * clamped to two lines), the reply count, and a CTA that NAVIGATES to the full
 * thread on the hub's Forum tab (Q2: no inline composer). States (spec §7):
 * hidden (logged out, untagged, hidden hub, `none`, error); loading skeleton;
 * empty; replies + "Join the discussion" (can reply); replies + "Sign up to
 * join the discussion" (can read, cannot reply); header + count only (cannot
 * read — the page's hub join prompt does the rest, ruling 16); Closed pill +
 * lock line + "Read the full thread" (locked). Tokens only.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import {
    ChatBubbleLeftRightIcon,
    LockClosedIcon,
} from '@heroicons/react/24/outline';
import type {
    EventDiscussionReady,
    EventResponseDto,
    HubForumReply,
} from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { buttonClass } from '../../components/ui/button-classes';
import { QuietEmpty } from '../../components/hub/card-bits';
import { Pill } from '../../components/hub/hub-bits';
import { ForumLockBar } from '../../components/hub/forum/forum-event-header';
import { forumThreadHref } from '../../components/hub/forum/forum-link';
import {
    forumAgo,
    forumAuthorName,
    replyCountLabel,
} from '../../components/hub/forum/forum-thread.helpers';
import { HUB_PAGE_PREFIX } from '../../components/routing/hub-paths';
import { useEventDiscussion } from './use-event-discussion';

export const DISCUSSION_EMPTY = 'No messages yet — be the first.';
export const DISCUSSION_SIGN_UP = 'Sign up to join the discussion.';

export interface EventDiscussionCardProps {
    event: Pick<EventResponseDto, 'id' | 'guildId' | 'hub'>;
    /** False when logged out (ruling 15: the card is hidden). */
    enabled: boolean;
}

/** `/hubs/<id>?thread=<id>#forum` — the full thread on the hub's Forum tab. */
export function discussionThreadHref(
    d: Pick<EventDiscussionReady, 'guildId' | 'threadId'>,
): string {
    return `${HUB_PAGE_PREFIX}${d.guildId}${forumThreadHref(d.threadId)}`;
}

function ReplyRow({ reply }: { reply: HubForumReply }): JSX.Element {
    const name = forumAuthorName(reply.author);
    return (
        <li
            data-testid="event-discussion-reply"
            className="flex gap-2.5 border-t border-edge-subtle py-2.5 first:border-t-0 first:pt-0"
        >
            <AvatarWithFallback
                username={name}
                avatarUrl={reply.author?.avatarUrl ?? null}
                sizeClassName="h-7 w-7"
                alt=""
            />
            <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-1.5 text-sm">
                    <span className="font-semibold text-foreground">
                        {name}
                    </span>
                    <span className="text-xs text-dim">
                        {forumAgo(reply.createdAt)}
                    </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-secondary">
                    {reply.body}
                </p>
            </div>
        </li>
    );
}

function DiscussionReplies({
    replies,
}: {
    replies: HubForumReply[];
}): JSX.Element {
    const live = replies.filter((r) => r.deleted === null);
    if (live.length === 0)
        return (
            <QuietEmpty testId="event-discussion-empty">
                {DISCUSSION_EMPTY}
            </QuietEmpty>
        );
    return (
        <ul className="flex flex-col">
            {live.map((r) => (
                <ReplyRow key={r.id} reply={r} />
            ))}
        </ul>
    );
}

function ThreadLink({
    d,
    primary,
}: {
    d: EventDiscussionReady;
    primary: boolean;
}): JSX.Element {
    return (
        <Link
            to={discussionThreadHref(d)}
            data-testid="event-discussion-cta"
            className={buttonClass({
                variant: primary ? 'primary' : 'secondary',
                size: 'md',
            })}
        >
            {primary && (
                <ChatBubbleLeftRightIcon
                    className="h-4 w-4"
                    aria-hidden="true"
                />
            )}
            {primary ? 'Join the discussion' : 'Read the full thread'}
        </Link>
    );
}

/** The footer: lock line, the reader's sign-up note, or the primary CTA. */
function DiscussionFoot({ d }: { d: EventDiscussionReady }): JSX.Element {
    const reply = d.lock === null && d.can.reply;
    return (
        <div className="mt-3 flex flex-col gap-3 border-t border-edge pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {d.lock !== null && (
                <div className="flex-1">
                    <ForumLockBar lock={d.lock} />
                </div>
            )}
            {d.lock === null && !reply && (
                <p
                    className="text-sm text-muted"
                    data-testid="event-discussion-signup-note"
                >
                    {DISCUSSION_SIGN_UP}
                </p>
            )}
            {reply && <span className="hidden sm:block" />}
            <ThreadLink d={d} primary={reply} />
        </div>
    );
}

function DiscussionFrame({ d }: { d: EventDiscussionReady }): JSX.Element {
    return (
        <section
            className="mb-6 rounded-xl border border-edge bg-surface p-4"
            data-testid="event-discussion-card"
            aria-labelledby="event-discussion-title"
        >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2
                    id="event-discussion-title"
                    className="flex items-center gap-2 text-lg font-semibold text-foreground"
                >
                    <ChatBubbleLeftRightIcon
                        className="h-5 w-5 shrink-0"
                        aria-hidden="true"
                    />
                    Discussion
                    {d.lock !== null && (
                        <Pill>
                            <LockClosedIcon
                                className="h-3 w-3"
                                aria-hidden="true"
                            />
                            Closed
                        </Pill>
                    )}
                </h2>
                <span
                    className="text-xs text-muted"
                    data-testid="event-discussion-count"
                >
                    {replyCountLabel(d.replyCount)}
                </span>
            </div>
            {d.can.read && <DiscussionReplies replies={d.latestReplies} />}
            {d.can.read && <DiscussionFoot d={d} />}
        </section>
    );
}

/** The event page Discussion card (see file docstring). */
export function EventDiscussionCard({
    event,
    enabled,
}: EventDiscussionCardProps): JSX.Element | null {
    const visible = enabled && event.guildId != null && event.hub != null;
    const query = useEventDiscussion(event.id, visible);
    if (!visible || query.isError) return null;
    if (query.isPending) {
        return (
            <div
                className="mb-6 h-24 animate-pulse rounded-xl border border-edge bg-panel"
                aria-busy="true"
                aria-label="Loading discussion"
            />
        );
    }
    return query.data.state === 'none' ? null : (
        <DiscussionFrame d={query.data} />
    );
}
