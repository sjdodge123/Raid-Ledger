/**
 * ROK-2226 — the Discussion card's reply preview and footer (split from
 * `EventDiscussionCard.tsx` to keep it near its budget). The footer carries
 * the lock line, the reader's sign-up note + the page's own Sign up action
 * (mockup "reader" state), or the primary CTA. Tokens only.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import type { EventDiscussionReady, HubForumReply } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../components/shared/AvatarWithFallback';
import { Button } from '../../components/ui/button';
import { buttonClass } from '../../components/ui/button-classes';
import { QuietEmpty } from '../../components/hub/card-bits';
import { ForumLockBar } from '../../components/hub/forum/forum-event-header';
import { forumAgo, forumAuthorName } from '../../components/hub/forum/forum-thread.helpers';
import { discussionPanelHref } from './event-discussion-link';

export const DISCUSSION_EMPTY = 'No messages yet — be the first.';
export const DISCUSSION_SIGN_UP = 'Sign up to join the discussion.';

/** The page's existing signup action, offered to a reader who may still join (absent = no button). */
export interface DiscussionSignup {
    onSignup: () => void;
    pending: boolean;
}

function ReplyRow({ reply }: { reply: HubForumReply }): JSX.Element {
    const name = forumAuthorName(reply.author);
    return (
        <li data-testid="event-discussion-reply" className="flex gap-2.5 border-t border-edge-subtle py-2.5 first:border-t-0 first:pt-0">
            <AvatarWithFallback username={name} avatarUrl={reply.author?.avatarUrl ?? null} sizeClassName="h-7 w-7" alt="" />
            <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-1.5 text-sm">
                    <span className="font-semibold text-foreground">{name}</span>
                    <span className="text-xs text-dim">{forumAgo(reply.createdAt)}</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-secondary">{reply.body}</p>
            </div>
        </li>
    );
}

/** The ≤3 newest live replies, or the quiet empty line. */
export function DiscussionReplies({ replies }: { replies: HubForumReply[] }): JSX.Element {
    const live = replies.filter((r) => r.deleted === null);
    if (live.length === 0) return <QuietEmpty testId="event-discussion-empty">{DISCUSSION_EMPTY}</QuietEmpty>;
    return <ul className="flex flex-col">{live.map((r) => <ReplyRow key={r.id} reply={r} />)}</ul>;
}

function ThreadLink({ eventId, primary }: { eventId: number; primary: boolean }): JSX.Element {
    return (
        <Link to={discussionPanelHref(eventId)} data-testid="event-discussion-cta"
            className={buttonClass({ variant: primary ? 'primary' : 'secondary', size: 'md' })}>
            {primary && <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />}
            {primary ? 'Join the discussion' : 'Read the full thread'}
        </Link>
    );
}

/** The reader's note + "Sign up" (the event page's own signup action, never a new one). */
export function DiscussionSignupNote({ signup }: { signup: DiscussionSignup | undefined }): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted" data-testid="event-discussion-signup-note">{DISCUSSION_SIGN_UP}</p>
            {signup !== undefined && (
                <Button size="sm" onClick={signup.onSignup} loading={signup.pending} data-testid="event-discussion-signup">Sign up</Button>
            )}
        </div>
    );
}

export interface DiscussionFootProps { eventId: number; d: EventDiscussionReady; signup: DiscussionSignup | undefined }

/** The footer: lock line, the reader's sign-up note, or the primary CTA. */
export function DiscussionFoot({ eventId, d, signup }: DiscussionFootProps): JSX.Element {
    const reply = d.lock === null && d.can.reply;
    return (
        <div className="mt-3 flex flex-col gap-3 border-t border-edge pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {d.lock !== null && <div className="flex-1"><ForumLockBar lock={d.lock} /></div>}
            {d.lock === null && !reply && <DiscussionSignupNote signup={signup} />}
            {reply && <span className="hidden sm:block" />}
            <ThreadLink eventId={eventId} primary={reply} />
        </div>
    );
}
