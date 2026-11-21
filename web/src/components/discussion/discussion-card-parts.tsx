/**
 * ROK-2272 S9 (lifted from ROK-2226's event card) — the subject-agnostic
 * Discussion card pieces: the card frame + heading ("Discussion", Closed pill,
 * reply count), the ≤3-reply preview, the reader note and the CTA link. The
 * event card (`pages/event-detail/EventDiscussionCard.tsx`) and the poll /
 * lineup card (`SubjectDiscussionCard.tsx`) both compose these. Test ids are
 * `<kind>-discussion-*`, so the event card's ids are unchanged. Tokens only.
 */
import type { JSX, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
    ChatBubbleLeftRightIcon,
    LockClosedIcon,
} from '@heroicons/react/24/outline';
import type {
    DiscussionSubjectKind,
    HubForumReply,
    SubjectDiscussionReady,
} from '@raid-ledger/contract';
import { AvatarWithFallback } from '../shared/AvatarWithFallback';
import { Button } from '../ui/button';
import { buttonClass } from '../ui/button-classes';
import { Pill } from '../hub/hub-bits';
import { QuietEmpty } from '../hub/card-bits';
import {
    forumAgo,
    forumAuthorName,
    replyCountLabel,
} from '../hub/forum/forum-thread.helpers';

export const DISCUSSION_EMPTY = 'No messages yet — be the first.';

/** The page's own join action (event signup, poll vote …) offered to a reader; absent = no button. */
export interface DiscussionSignup {
    onSignup: () => void;
    pending: boolean;
}

type Kind = DiscussionSubjectKind;

function ReplyRow({ kind, reply }: { kind: Kind; reply: HubForumReply }): JSX.Element {
    const name = forumAuthorName(reply.author);
    return (
        <li
            data-testid={`${kind}-discussion-reply`}
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
                    <span className="font-semibold text-foreground">{name}</span>
                    <span className="text-xs text-dim">{forumAgo(reply.createdAt)}</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-sm text-secondary">{reply.body}</p>
            </div>
        </li>
    );
}

/** The ≤3 newest live replies, or the quiet empty line. */
export function SubjectDiscussionReplies({
    kind,
    replies,
}: {
    kind: Kind;
    replies: HubForumReply[];
}): JSX.Element {
    const live = replies.filter((r) => r.deleted === null);
    if (live.length === 0)
        return <QuietEmpty testId={`${kind}-discussion-empty`}>{DISCUSSION_EMPTY}</QuietEmpty>;
    return (
        <ul className="flex flex-col">
            {live.map((r) => (
                <ReplyRow key={r.id} kind={kind} reply={r} />
            ))}
        </ul>
    );
}

/** The "Closed" pill a locked thread's heading carries. */
function ClosedPill(): JSX.Element {
    return (
        <Pill>
            <LockClosedIcon className="h-3 w-3" aria-hidden="true" />
            Closed
        </Pill>
    );
}

/** "Discussion" title (+ Closed pill once locked) and the reply count. */
function DiscussionHeading({ kind, d }: { kind: Kind; d: SubjectDiscussionReady }): JSX.Element {
    return (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2
                id={`${kind}-discussion-title`}
                className="flex items-center gap-2 text-lg font-semibold text-foreground"
            >
                <ChatBubbleLeftRightIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                Discussion
                {d.lock !== null && <ClosedPill />}
            </h2>
            <span className="text-xs text-muted" data-testid={`${kind}-discussion-count`}>
                {replyCountLabel(d.replyCount)}
            </span>
        </div>
    );
}

/** The card frame: heading, then (when the viewer may read) the preview and the caller's footer. */
export function SubjectDiscussionFrame({
    kind,
    d,
    foot,
    flush = false,
}: {
    kind: Kind;
    d: SubjectDiscussionReady;
    foot: ReactNode;
    /** True drops the bottom margin, for pages that space their sections (`space-y-*`). */
    flush?: boolean;
}): JSX.Element {
    return (
        <section
            className={`${flush ? '' : 'mb-6 '}rounded-xl border border-edge bg-surface p-4`}
            data-testid={`${kind}-discussion-card`}
            aria-labelledby={`${kind}-discussion-title`}
        >
            <DiscussionHeading kind={kind} d={d} />
            {d.can.read && <SubjectDiscussionReplies kind={kind} replies={d.latestReplies} />}
            {d.can.read && foot}
        </section>
    );
}

/** The loading skeleton every Discussion card shows while its summary is in flight. */
export function DiscussionCardSkeleton({ flush = false }: { flush?: boolean }): JSX.Element {
    return (
        <div
            className={`${flush ? '' : 'mb-6 '}h-24 animate-pulse rounded-xl border border-edge bg-panel`}
            aria-busy="true"
            aria-label="Loading discussion"
        />
    );
}

/** The footer row under the preview (border-top, stacked on phones). */
export function DiscussionFootRow({ children }: { children: ReactNode }): JSX.Element {
    return (
        <div className="mt-3 flex flex-col gap-3 border-t border-edge pt-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {children}
        </div>
    );
}

/** The CTA: a router `Link` styled as a button (primary "Join", secondary "Read"). */
export function DiscussionCtaLink({
    kind,
    to,
    primary,
    children,
    testId,
}: {
    kind: Kind;
    to: string;
    primary: boolean;
    children: ReactNode;
    /** Defaults to `${kind}-discussion-cta`. */
    testId?: string | undefined;
}): JSX.Element {
    return (
        <Link
            to={to}
            data-testid={testId ?? `${kind}-discussion-cta`}
            className={buttonClass({ variant: primary ? 'primary' : 'secondary', size: 'md' })}
        >
            {primary && <ChatBubbleLeftRightIcon className="h-4 w-4" aria-hidden="true" />}
            {children}
        </Link>
    );
}

/** The reader's muted note + the page's own join action (never a new one). */
export function DiscussionReaderNote({
    kind,
    text,
    signup,
}: {
    kind: Kind;
    text: string;
    signup: DiscussionSignup | undefined;
}): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted" data-testid={`${kind}-discussion-signup-note`}>
                {text}
            </p>
            {signup !== undefined && (
                <Button
                    size="sm"
                    onClick={signup.onSignup}
                    loading={signup.pending}
                    data-testid={`${kind}-discussion-signup`}
                >
                    Sign up
                </Button>
            )}
        </div>
    );
}
