/**
 * ROK-2226 — the event Discussion card's footer, over the subject-agnostic
 * pieces lifted to `components/discussion/` (ROK-2272 S9). The footer carries
 * the lock line, the reader's sign-up note + the page's own Sign up action
 * (mockup "reader" state), or the primary CTA. Tokens only.
 */
import type { JSX } from 'react';
import type {
    EventDiscussionReady,
    HubForumReply,
} from '@raid-ledger/contract';
import { ForumLockBar } from '../../components/hub/forum/forum-event-header';
import {
    DiscussionCtaLink,
    DiscussionFootRow,
    DiscussionReaderNote,
    SubjectDiscussionReplies,
    type DiscussionSignup,
} from '../../components/discussion/discussion-card-parts';
import { discussionCtaHref } from './event-discussion-link';

export {
    DISCUSSION_EMPTY,
    type DiscussionSignup,
} from '../../components/discussion/discussion-card-parts';

export const DISCUSSION_SIGN_UP = 'Sign up to join the discussion.';

/** The ≤3 newest live replies, or the quiet empty line. */
export function DiscussionReplies({
    replies,
}: {
    replies: HubForumReply[];
}): JSX.Element {
    return <SubjectDiscussionReplies kind="event" replies={replies} />;
}

/** The reader's note + "Sign up" (the event page's own signup action, never a new one). */
export function DiscussionSignupNote({
    signup,
}: {
    signup: DiscussionSignup | undefined;
}): JSX.Element {
    return (
        <DiscussionReaderNote
            kind="event"
            text={DISCUSSION_SIGN_UP}
            signup={signup}
        />
    );
}

export interface DiscussionFootProps {
    eventId: number;
    d: EventDiscussionReady;
    signup: DiscussionSignup | undefined;
}

/** The footer: lock line, the reader's sign-up note, or the primary CTA. */
export function DiscussionFoot({
    eventId,
    d,
    signup,
}: DiscussionFootProps): JSX.Element {
    const reply = d.lock === null && d.can.reply;
    return (
        <DiscussionFootRow>
            {d.lock !== null && (
                <div className="flex-1">
                    <ForumLockBar lock={d.lock} />
                </div>
            )}
            {d.lock === null && !reply && (
                <DiscussionSignupNote signup={signup} />
            )}
            {reply && <span className="hidden sm:block" />}
            <DiscussionCtaLink
                kind="event"
                to={discussionCtaHref(eventId, d)}
                primary={reply}
            >
                {reply ? 'Join the discussion' : 'Read the full thread'}
            </DiscussionCtaLink>
        </DiscussionFootRow>
    );
}
