/**
 * ROK-2272 S9 — the poll / lineup page Discussion card: hidden (signed out,
 * `none` — private poll / no hub —, error), can reply (posts inline and
 * refetches), reader (R7 note), cannot read, closed (subject copy, never the
 * event copy), locked-in poll (decided line + event link), hub member link,
 * the composer's 403 / 409 / 429 copy, and the lineup route.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { SubjectDiscussion, SubjectDiscussionReady } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import { buildForumLock, buildForumReply } from '../../test/factories/hub-forum';
import type { MarkdownEditorProps } from '../ui/markdown/lazy-markdown-editor';
import { EVENT_ENDED_LOCK_COPY } from '../hub/forum/forum-event-format';
import { SubjectDiscussionCard, type SubjectDiscussionCardProps } from './SubjectDiscussionCard';
import {
    POLL_DECIDED_LOCK_LINE,
    SUBJECT_CLOSED_LOCK_LINE,
    SUBJECT_READER_NOTE,
    SUBJECT_REPLY_READ_ONLY,
    SUBJECT_REPLY_TOO_FAST,
} from './subject-discussion-api';

vi.mock('../ui/markdown/lazy-markdown-editor', async () => {
    const { Textarea } = await import('../ui/textarea');
    return {
        LazyMarkdownEditor: (p: MarkdownEditorProps) => (
            <Textarea value={p.value} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testId} />
        ),
    };
});

const API = 'http://localhost:3000';
const POLL_URL = `${API}/scheduling-polls/31/discussion`;
const LINEUP_URL = `${API}/lineups/9/discussion`;
const POLL: SubjectDiscussionCardProps['subject'] = { kind: 'poll', id: 31 };
let calls = 0;

function ready(overrides: Partial<SubjectDiscussionReady> = {}): SubjectDiscussionReady {
    return {
        state: 'ready',
        kind: 'poll',
        guildId: 7,
        threadId: 5,
        replyCount: 1,
        latestReplies: [buildForumReply({ id: 21, body: 'Friday works for me.' })],
        lock: null,
        can: { read: true, reply: true },
        ...overrides,
    };
}

function serve(body: SubjectDiscussion, url = POLL_URL): void {
    server.use(
        http.get(url, () => {
            calls += 1;
            return HttpResponse.json(body);
        }),
    );
}

function renderCard(props: Partial<SubjectDiscussionCardProps> = {}) {
    return renderWithProviders(<SubjectDiscussionCard subject={POLL} enabled {...props} />);
}

async function settled(): Promise<void> {
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.queryByLabelText('Loading discussion')).toBeNull());
}

async function typeAndSubmit(text: string): Promise<void> {
    const user = userEvent.setup();
    await user.type(await screen.findByTestId('forum-reply-input'), text);
    await user.click(screen.getByTestId('forum-reply-submit'));
}

function failReplies(status: number): void {
    server.use(
        http.post(`${POLL_URL}/replies`, () => HttpResponse.json({ message: 'no' }, { status })),
    );
}

beforeEach(() => {
    calls = 0;
});

describe('SubjectDiscussionCard — hidden', () => {
    it('renders nothing and never fetches when signed out', async () => {
        serve(ready());
        renderCard({ enabled: false });
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByTestId('poll-discussion-card')).toBeNull();
        expect(calls).toBe(0);
    });

    it('renders nothing for a private poll or a poll with no hub (`none`)', async () => {
        serve({ state: 'none' });
        renderCard();
        await settled();
        expect(screen.queryByTestId('poll-discussion-card')).toBeNull();
    });

    it('renders nothing when the summary 404s', async () => {
        server.use(
            http.get(POLL_URL, () => {
                calls += 1;
                return HttpResponse.json({ message: 'Not found' }, { status: 404 });
            }),
        );
        renderCard();
        await settled();
        expect(screen.queryByTestId('poll-discussion-card')).toBeNull();
    });
});

describe('SubjectDiscussionCard — voter can reply (R7)', () => {
    it('posts the reply inline, then refetches the summary and shows it', async () => {
        const posted: unknown[] = [];
        serve(ready());
        server.use(
            http.post(`${POLL_URL}/replies`, async ({ request }) => {
                posted.push(await request.json());
                serve(ready({
                    replyCount: 2,
                    latestReplies: [
                        buildForumReply({ id: 21, body: 'Friday works for me.' }),
                        buildForumReply({ id: 22, body: 'Saturday is better.' }),
                    ],
                }));
                return HttpResponse.json(buildForumReply({ id: 22, body: 'Saturday is better.' }));
            }),
        );
        renderCard();
        await typeAndSubmit('Saturday is better.');
        await waitFor(() => expect(posted).toEqual([{ body: 'Saturday is better.' }]));
        expect(await screen.findByText('Saturday is better.')).toBeInTheDocument();
        expect(screen.getByTestId('poll-discussion-count')).toHaveTextContent('2 replies');
        expect(screen.getByTestId('forum-reply-input')).toHaveValue('');
        expect(screen.queryByTestId('poll-discussion-signup-note')).toBeNull();
    });

    it.each<[number, string]>([
        [403, SUBJECT_READER_NOTE.poll],
        [409, SUBJECT_REPLY_READ_ONLY],
        [429, SUBJECT_REPLY_TOO_FAST],
    ])('a %i on post shows its own copy in the composer', async (status, copy) => {
        serve(ready());
        failReplies(status);
        renderCard();
        await typeAndSubmit('Hello there');
        expect(await screen.findByText(copy)).toBeInTheDocument();
    });
});

describe('SubjectDiscussionCard — read-only states', () => {
    it('non-voter: replies, the poll reader note, and no composer (R7)', async () => {
        serve(ready({ can: { read: true, reply: false } }));
        renderCard();
        expect(await screen.findByText('Friday works for me.')).toBeInTheDocument();
        expect(screen.getByText(SUBJECT_READER_NOTE.poll)).toBeInTheDocument();
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });

    it('cannot read: header and count only', async () => {
        serve(ready({ replyCount: 4, latestReplies: [], can: { read: false, reply: false } }));
        renderCard();
        expect(await screen.findByTestId('poll-discussion-count')).toHaveTextContent('4 replies');
        expect(screen.queryAllByTestId('poll-discussion-reply')).toHaveLength(0);
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });

    it('closed thread: the subject lock line, never the event copy, and no composer', async () => {
        serve(ready({ lock: buildForumLock({ reason: 'event-ended' }) }));
        renderCard();
        const bar = await screen.findByTestId('forum-lock-bar');
        expect(bar).toHaveTextContent(SUBJECT_CLOSED_LOCK_LINE);
        expect(bar).not.toHaveTextContent(EVENT_ENDED_LOCK_COPY);
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
        expect(screen.queryByText(SUBJECT_READER_NOTE.poll)).toBeNull();
    });

    it('locked-in poll: the decided line and "View the event", even while the api still allows replies', async () => {
        serve(ready());
        renderCard({ lockedInEventId: 88 });
        const cta = await screen.findByTestId('poll-discussion-cta');
        expect(screen.getByTestId('poll-discussion-card')).toHaveTextContent(POLL_DECIDED_LOCK_LINE);
        expect(cta).toHaveTextContent('View the event');
        expect(cta).toHaveAttribute('href', '/events/88');
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });

    it('hub member: "Read the full thread" links the hub Forum thread', async () => {
        serve(ready({ member: true, can: { read: true, reply: false } }));
        renderCard();
        const link = await screen.findByTestId('poll-discussion-hub-link');
        expect(link).toHaveTextContent('Read the full thread');
        expect(link.getAttribute('href')).toMatch(/^\/hubs\/7.*thread=5/);
    });
});

describe('SubjectDiscussionCard — lineup', () => {
    it('fetches the lineup route and shows the lineup reader note', async () => {
        serve(ready({ kind: 'lineup', can: { read: true, reply: false } }), LINEUP_URL);
        renderCard({ subject: { kind: 'lineup', id: 9 } });
        expect(await screen.findByTestId('lineup-discussion-card')).toBeInTheDocument();
        expect(screen.getByText(SUBJECT_READER_NOTE.lineup)).toBeInTheDocument();
        expect(calls).toBe(1);
    });
});
