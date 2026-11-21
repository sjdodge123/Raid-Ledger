/**
 * ROK-2272 S9 — the poll / lineup Discussion card's data (api S7, R10):
 * `GET /scheduling-polls/:matchId/discussion` + `POST …/replies` and
 * `GET /lineups/:id/discussion` + `POST …/replies`. There is no thread/edit
 * route for these subjects, so the card posts inline and members open the
 * full thread on the hub. Keyed per viewer — `can` and `latestReplies`
 * depend on who is asking (voted / nominated, member, visitor).
 */
import {
    useMutation,
    useQuery,
    useQueryClient,
    type UseMutationResult,
    type UseQueryResult,
} from '@tanstack/react-query';
import {
    HubForumReplySchema,
    SubjectDiscussionSchema,
    type HubForumLock,
    type HubForumReply,
    type SubjectDiscussion,
} from '@raid-ledger/contract';
import { fetchApi } from '../../lib/api-client';
import { httpStatusOf } from '../../lib/api/api-error';
import { useViewerCacheScope } from '../../hooks/use-auth';
import type { ReplyVars } from '../hub/forum/use-hub-forum';
import {
    invalidateSubjectDiscussion,
    subjectDiscussionKey,
    type DiscussionSubject,
} from '../../hooks/subject-discussion-key';

export { subjectDiscussionKey, type DiscussionSubject };

function base(subject: DiscussionSubject): string {
    return subject.kind === 'poll'
        ? `/scheduling-polls/${subject.id}/discussion`
        : `/lineups/${subject.id}/discussion`;
}

/** The card summary: `none` (no hub, private, hidden), or ids, count, ≤3 replies, lock and `can`. */
export function fetchSubjectDiscussion(subject: DiscussionSubject): Promise<SubjectDiscussion> {
    return fetchApi(base(subject), {}, SubjectDiscussionSchema);
}

/** The summary query; `enabled` false (signed out) never fetches. */
export function useSubjectDiscussion(
    subject: DiscussionSubject,
    enabled: boolean,
): UseQueryResult<SubjectDiscussion, Error> {
    const viewer = useViewerCacheScope();
    return useQuery({
        queryKey: [...subjectDiscussionKey(subject), viewer],
        queryFn: () => fetchSubjectDiscussion(subject),
        enabled: enabled && subject.id > 0,
        retry: false,
        staleTime: 30_000,
    });
}

/** A 403 (lost reply access) or 409 (thread locked) means the card's `can` / `lock` are stale. */
const STALE_CARD_STATUSES = new Set([403, 409]);

/** POST a reply to the subject thread (`threadId` is implied by the URL); refetches the card on success, and on a 403 / 409 so the composer goes away. */
export function useCreateSubjectReply(
    subject: DiscussionSubject,
): UseMutationResult<HubForumReply, Error, ReplyVars> {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ body }: ReplyVars) =>
            fetchApi(
                `${base(subject)}/replies`,
                { method: 'POST', body: JSON.stringify({ body }) },
                HubForumReplySchema,
            ),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: subjectDiscussionKey(subject) }),
        onError: (error: Error) => {
            if (STALE_CARD_STATUSES.has(httpStatusOf(error) ?? 0)) invalidateSubjectDiscussion(queryClient, subject);
        },
    });
}

/** The reader note under the preview when the viewer may read but not reply (R7). */
export const SUBJECT_READER_NOTE: Record<DiscussionSubject['kind'], string> = {
    poll: 'Vote in the poll to join the discussion.',
    lineup: 'Nominate or vote to join the discussion.',
};

export const SUBJECT_REPLY_READ_ONLY = 'This discussion is read-only now.';
export const SUBJECT_REPLY_TOO_FAST = 'You’re replying too fast. Wait a moment and try again.';

/** The composer's copy for the subject routes' 403 / 409 / 429; other failures use the generic line. */
export function subjectReplyFailureCopy(kind: DiscussionSubject['kind'], error: Error): string | undefined {
    const status = httpStatusOf(error);
    if (status === 403) return SUBJECT_READER_NOTE[kind];
    if (status === 409) return SUBJECT_REPLY_READ_ONLY;
    if (status === 429) return SUBJECT_REPLY_TOO_FAST;
    return undefined;
}

/** A locked-in poll's read-only line: the conversation moves to the event. */
export const POLL_DECIDED_LOCK_LINE = 'This poll is decided — discussion continues on the event';

/** A closed poll / lineup thread (private flip, hub untag, or past its close deadline). */
export const SUBJECT_CLOSED_LOCK_LINE = 'This discussion is closed';

/**
 * The lock line a poll / lineup card shows, or null while writable. The api
 * reuses the event lock reasons for these subjects, so the card never shows
 * event copy ("after the event ended") — a locked-in poll says it is decided,
 * anything else is simply closed.
 */
export function subjectLockLine(
    kind: DiscussionSubject['kind'],
    lock: HubForumLock | null,
    lockedInEventId: number | null,
): string | null {
    if (kind === 'poll' && lockedInEventId !== null) return POLL_DECIDED_LOCK_LINE;
    return lock === null ? null : SUBJECT_CLOSED_LOCK_LINE;
}
