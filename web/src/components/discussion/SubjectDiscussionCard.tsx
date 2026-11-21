/**
 * ROK-2272 S9 — the Discussion card on the scheduling-poll and lineup pages,
 * built from the same parts as the ROK-2226 event card (`discussion-card-parts`).
 * States: hidden (signed out, `none` — no hub, private poll, hidden — or
 * error); loading skeleton; replies + inline reply box (may reply, R7 — these
 * subjects have no thread panel route, so the card posts in place); replies +
 * reader note (may read, has not voted / nominated); header + count only
 * (cannot read); Closed pill + a subject lock line (never the event copy), or
 * a locked-in poll's "decided" line + "View the event" link (read-only).
 * Hub members also get "Read the full thread" on the hub Forum tab. Tokens only.
 */
import type { JSX } from 'react';
import type { SubjectDiscussionReady } from '@raid-ledger/contract';
import { ForumLockBar } from '../hub/forum/forum-event-header';
import { ForumReplyComposerView } from '../hub/forum/forum-composer';
import { forumThreadHref } from '../hub/forum/forum-link';
import { HUB_PAGE_PREFIX } from '../routing/hub-paths';
import {
    DiscussionCardSkeleton,
    DiscussionCtaLink,
    DiscussionFootRow,
    DiscussionReaderNote,
    SubjectDiscussionFrame,
} from './discussion-card-parts';
import {
    SUBJECT_READER_NOTE,
    subjectLockLine,
    subjectReplyFailureCopy,
    useCreateSubjectReply,
    useSubjectDiscussion,
    type DiscussionSubject,
} from './subject-discussion-api';

export interface SubjectDiscussionCardProps {
    subject: DiscussionSubject;
    /** False when signed out (the card is hidden and never fetches). */
    enabled: boolean;
    /** A locked-in poll's event: the card turns read-only and links there. */
    lockedInEventId?: number | null | undefined;
}

interface FootProps {
    subject: DiscussionSubject;
    d: SubjectDiscussionReady;
    lockedInEventId: number | null;
}

/** "Read the full thread" on the hub Forum tab — hub members only (non-members 403 there). */
function HubThreadLink({ subject, d }: Omit<FootProps, 'lockedInEventId'>): JSX.Element | null {
    if (d.member !== true) return null;
    return (
        <DiscussionCtaLink
            kind={subject.kind}
            to={`${HUB_PAGE_PREFIX}${d.guildId}${forumThreadHref(d.threadId)}`}
            primary={false}
            testId={`${subject.kind}-discussion-hub-link`}
        >
            Read the full thread
        </DiscussionCtaLink>
    );
}

function ReplyBox({ subject, d }: Omit<FootProps, 'lockedInEventId'>): JSX.Element {
    const create = useCreateSubjectReply(subject);
    return (
        <div className="mt-3 flex flex-col gap-3 border-t border-edge pt-3">
            <ForumReplyComposerView
                threadId={d.threadId}
                create={create}
                failureCopy={(e) => subjectReplyFailureCopy(subject.kind, e)}
            />
            <div className="flex justify-end">
                <HubThreadLink subject={subject} d={d} />
            </div>
        </div>
    );
}

/** Read-only footer: lock line / locked-in event link, or the reader note. */
function ReadOnlyFoot({ subject, d, lockedInEventId }: FootProps): JSX.Element {
    const line = subjectLockLine(subject.kind, d.lock, lockedInEventId);
    const closed = line !== null;
    return (
        <DiscussionFootRow>
            {line !== null && (
                <div className="flex-1">
                    <ForumLockBar lock={d.lock} line={line} />
                </div>
            )}
            {!closed && (
                <DiscussionReaderNote kind={subject.kind} text={SUBJECT_READER_NOTE[subject.kind]} signup={undefined} />
            )}
            {lockedInEventId !== null && (
                <DiscussionCtaLink kind={subject.kind} to={`/events/${lockedInEventId}`} primary>
                    View the event
                </DiscussionCtaLink>
            )}
            <HubThreadLink subject={subject} d={d} />
        </DiscussionFootRow>
    );
}

function SubjectFoot(props: FootProps): JSX.Element {
    const { d, lockedInEventId } = props;
    const canReply = d.can.reply && d.lock === null && lockedInEventId === null;
    return canReply ? <ReplyBox subject={props.subject} d={d} /> : <ReadOnlyFoot {...props} />;
}

/** The poll / lineup page Discussion card (see file docstring). */
export function SubjectDiscussionCard({
    subject,
    enabled,
    lockedInEventId,
}: SubjectDiscussionCardProps): JSX.Element | null {
    const query = useSubjectDiscussion(subject, enabled);
    if (!enabled || query.isError) return null;
    if (query.isPending) return <DiscussionCardSkeleton flush />;
    if (query.data.state === 'none') return null;
    const d = query.data;
    return (
        <SubjectDiscussionFrame
            kind={subject.kind}
            d={d}
            flush
            foot={<SubjectFoot subject={subject} d={d} lockedInEventId={lockedInEventId ?? null} />}
        />
    );
}
