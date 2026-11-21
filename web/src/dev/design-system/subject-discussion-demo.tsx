/**
 * ROK-2272 S9 — the poll / lineup Discussion card for /dev/design-system
 * (docs/design-system.md §4.35): voter (inline reply box), reader (R7 note),
 * a locked-in poll (decided line + "View the event") and a closed thread.
 * The real `SubjectDiscussionCard` renders from pre-filled cache entries under
 * NEGATIVE subject ids — `useSubjectDiscussion` never fetches an id <= 0 — so the
 * gallery shows exactly what ships without a network call, and the viewer scope
 * is the page's own. Shown inside `/dev/design-system`, which is DEMO_MODE-gated
 * (`DesignSystemPage`). Tokens only.
 */
import { useState, type JSX } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { HubForumReply, SubjectDiscussionReady } from '@raid-ledger/contract';
import { SubjectDiscussionCard } from '../../components/discussion/SubjectDiscussionCard';
import { subjectDiscussionKey, type DiscussionSubject } from '../../hooks/subject-discussion-key';
import { useViewerCacheScope } from '../../hooks/use-auth';
import { StateFrame } from './design-system-bits';

const REPLY: HubForumReply = {
    id: 1,
    body: 'Friday works for me — Saturday is a stretch.',
    author: { userId: 2, displayName: 'Mossbeard', avatarUrl: null },
    createdAt: '2026-11-18T19:00:00.000Z',
    editedAt: null,
    deleted: null,
    can: { edit: false, delete: false, pin: false },
};

const READY: SubjectDiscussionReady = {
    state: 'ready',
    kind: 'poll',
    guildId: 1,
    threadId: 1,
    replyCount: 1,
    latestReplies: [REPLY],
    lock: null,
    can: { read: true, reply: true },
};

interface DemoCase {
    label: string;
    subject: DiscussionSubject;
    data: SubjectDiscussionReady;
    lockedInEventId?: number;
}

const CASES: readonly DemoCase[] = [
    { label: 'Voter — reply inline', subject: { kind: 'poll', id: -9_001 }, data: READY },
    { label: 'Reader — has not voted (R7)', subject: { kind: 'poll', id: -9_002 }, data: { ...READY, can: { read: true, reply: false } } },
    { label: 'Locked-in poll — decided', subject: { kind: 'poll', id: -9_003 }, data: READY, lockedInEventId: 42 },
    {
        label: 'Closed lineup thread',
        subject: { kind: 'lineup', id: -9_004 },
        data: { ...READY, kind: 'lineup', lock: { at: '2026-11-23T22:00:00.000Z', reason: 'event-ended' } },
    },
];

/** Seed each case under the card's own key (subject + viewer scope); disabled queries keep it. */
function seed(client: QueryClient, viewer: number | 'anon'): void {
    for (const c of CASES) client.setQueryData([...subjectDiscussionKey(c.subject), viewer], c.data);
}

/** One frame: the four poll / lineup card states, each from a pre-filled cache entry. */
export function SubjectDiscussionDemo(): JSX.Element {
    const client = useQueryClient();
    const viewer = useViewerCacheScope();
    // Re-seed when the viewer scope changes (auth resolving after mount) — the
    // "adjust state while rendering" pattern, so the seed lands before the cards read it.
    const [seededFor, setSeededFor] = useState<number | 'anon' | null>(null);
    if (seededFor !== viewer) {
        seed(client, viewer);
        setSeededFor(viewer);
    }
    return (
        <StateFrame
            label="Poll / lineup discussion — SubjectDiscussionCard"
            note="SubjectDiscussionCard.tsx (ROK-2272 S9): same parts as the event card; replies post inline, a locked-in poll links its event, and lock lines use subject copy, never event copy."
        >
            <div className="flex w-full flex-col gap-4" data-testid="ds-subject-discussion">
                {CASES.map((c) => (
                    <div key={c.label} className="flex flex-col gap-1">
                        <span className="text-xs text-muted">{c.label}</span>
                        <SubjectDiscussionCard subject={c.subject} enabled lockedInEventId={c.lockedInEventId ?? null} />
                    </div>
                ))}
            </div>
        </StateFrame>
    );
}
