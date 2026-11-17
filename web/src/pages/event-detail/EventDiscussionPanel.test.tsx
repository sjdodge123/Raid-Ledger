/**
 * ROK-2226 L4b — the `?discussion=1` panel: a signed-up non-member reads and
 * replies through the event-scoped routes (never the hub forum), a reader gets
 * the sign-up note + the page's Sign up action, a locked thread takes no
 * replies, and the thread GET / reply POST failures (403/409/429) show copy.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { EventDiscussion, HubForumThread } from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    buildEventDiscussion,
    buildForumLock,
    buildForumReply,
    buildForumThreadDetail,
    buildForumThreadEvent,
} from '../../test/factories/hub-forum';
import type { MarkdownEditorProps } from '../../components/ui/markdown/lazy-markdown-editor';
import { lockReasonCopy } from '../../components/hub/forum/forum-event-format';
import { DISCUSSION_SIGN_UP } from './event-discussion-card-parts';
import {
    DISCUSSION_FORBIDDEN,
    DISCUSSION_LOAD_FAILED,
    EventDiscussionPanel,
    EventDiscussionSection,
    type EventDiscussionPanelProps,
} from './EventDiscussionPanel';
import { signedUpLabel } from './event-discussion-labels';
import {
    EVENT_REPLY_NOT_SIGNED_UP,
    EVENT_REPLY_READ_ONLY,
    EVENT_REPLY_TOO_FAST,
} from './use-event-discussion-thread';

vi.mock('../../components/ui/markdown/lazy-markdown-editor', async () => {
    const { Textarea } = await import('../../components/ui/textarea');
    return {
        LazyMarkdownEditor: (p: MarkdownEditorProps) => (
            <Textarea
                value={p.value}
                onChange={(e) => p.onChange(e.target.value)}
                data-testid={p.testId}
            />
        ),
    };
});

const BASE = 'http://localhost:3000/events/42/discussion';
const EVENT: EventDiscussionPanelProps['event'] = {
    id: 42,
    guildId: 7,
    hub: { id: 7, name: 'Hearthbound', kind: 'wow_guild' },
    signupCount: 18,
    maxAttendees: 40,
};
let threadGets = 0;
let hubHits = 0;
let posted: unknown[] = [];

function thread(overrides: Partial<HubForumThread> = {}): HubForumThread {
    return buildForumThreadDetail({
        id: 5,
        title: 'Molten Core — Sun 22 Nov',
        event: buildForumThreadEvent(),
        lock: null,
        canReply: true,
        replies: [buildForumReply({ id: 21, body: 'Bringing potions.' })],
        ...overrides,
    });
}

function serveThread(body: HubForumThread): void {
    server.use(
        http.get(`${BASE}/thread`, () => {
            threadGets += 1;
            return HttpResponse.json(body);
        }),
    );
}

function servePost(status: number): void {
    server.use(
        http.post(`${BASE}/replies`, async ({ request }) => {
            posted.push(await request.json());
            return status === 201
                ? HttpResponse.json(
                      buildForumReply({ id: 30, body: 'On my way.' }),
                      { status },
                  )
                : HttpResponse.json({ message: 'nope' }, { status });
        }),
    );
}

function renderPanel(props: Partial<EventDiscussionPanelProps> = {}) {
    return renderWithProviders(
        <EventDiscussionPanel event={EVENT} {...props} />,
    );
}

beforeEach(() => {
    threadGets = 0;
    hubHits = 0;
    posted = [];
    server.use(
        http.all('http://localhost:3000/guilds/7/forum*', () => {
            hubHits += 1;
            return HttpResponse.json({}, { status: 403 });
        }),
    );
});

describe('EventDiscussionPanel — signed-up non-member (OQ-11)', () => {
    it('reads the thread and posts a reply through the event routes, never the hub forum', async () => {
        serveThread(thread());
        servePost(201);
        renderPanel();
        expect(
            await screen.findByText('Bringing potions.'),
        ).toBeInTheDocument();
        await userEvent.type(
            screen.getByTestId('forum-reply-input'),
            'On my way.',
        );
        await userEvent.click(screen.getByTestId('forum-reply-submit'));
        await waitFor(() => expect(posted).toEqual([{ body: 'On my way.' }]));
        await waitFor(() =>
            expect(threadGets, 'a posted reply refetches the thread').toBe(2),
        );
        expect(
            hubHits,
            'the members-only hub forum routes are never called',
        ).toBe(0);
    });

    it('shows the signed-up line from the event (mockup header)', async () => {
        serveThread(thread());
        renderPanel();
        expect(
            await screen.findByTestId('event-discussion-signed-up'),
        ).toHaveTextContent('18 / 40 signed up');
        expect(screen.getByTestId('event-discussion-back')).toHaveAttribute(
            'href',
            '/events/42',
        );
    });

    it.each<[number, string]>([
        [403, EVENT_REPLY_NOT_SIGNED_UP],
        [409, EVENT_REPLY_READ_ONLY],
        [429, EVENT_REPLY_TOO_FAST],
    ])('a %s on POST shows "%s" under the composer', async (status, copy) => {
        serveThread(thread());
        servePost(status);
        renderPanel();
        await userEvent.type(
            await screen.findByTestId('forum-reply-input'),
            'Hello',
        );
        await userEvent.click(screen.getByTestId('forum-reply-submit'));
        expect(await screen.findByText(copy)).toBeInTheDocument();
    });
});

describe('EventDiscussionPanel — reader and locked', () => {
    it('reader: no composer, the sign-up note and the page signup action', async () => {
        const onSignup = vi.fn();
        serveThread(thread({ canReply: false }));
        renderPanel({ signup: { onSignup, pending: false } });
        expect(
            await screen.findByTestId('event-discussion-signup-note'),
        ).toHaveTextContent(DISCUSSION_SIGN_UP);
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
        await userEvent.click(screen.getByTestId('event-discussion-signup'));
        expect(onSignup).toHaveBeenCalledTimes(1);
    });

    it('reader with no signup action (ended, cancelled, already in): note only, no button', async () => {
        serveThread(thread({ canReply: false }));
        renderPanel();
        expect(
            await screen.findByTestId('event-discussion-signup-note'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('event-discussion-signup')).toBeNull();
    });

    it('locked: the reason line, no composer and no sign-up note', async () => {
        serveThread(thread({ canReply: false, lock: buildForumLock() }));
        renderPanel({ signup: { onSignup: vi.fn(), pending: false } });
        // The reason sits inside the bar's larger "Discussion closed · Read-only since … · <reason>" span.
        expect(await screen.findByTestId('forum-lock-bar')).toHaveTextContent(
            lockReasonCopy('event-ended'),
        );
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
        expect(screen.queryByTestId('event-discussion-signup-note')).toBeNull();
    });
});

describe('EventDiscussionPanel — thread load failures', () => {
    it.each<[number, string]>([
        [403, DISCUSSION_FORBIDDEN],
        [500, DISCUSSION_LOAD_FAILED],
    ])('a %s on the thread GET shows "%s"', async (status, copy) => {
        server.use(
            http.get(`${BASE}/thread`, () =>
                HttpResponse.json({ message: 'x' }, { status }),
            ),
        );
        renderPanel();
        expect(await screen.findByRole('alert')).toHaveTextContent(copy);
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });

    it('a 403 on a refetch (signup withdrawn) drops the cached replies and composer', async () => {
        let forbidden = false;
        server.use(
            http.get(`${BASE}/thread`, () =>
                forbidden
                    ? HttpResponse.json({ message: 'x' }, { status: 403 })
                    : HttpResponse.json(thread()),
            ),
        );
        servePost(201);
        renderPanel();
        expect(await screen.findByText('Bringing potions.')).toBeInTheDocument();
        forbidden = true;
        await userEvent.type(screen.getByTestId('forum-reply-input'), 'Bye');
        await userEvent.click(screen.getByTestId('forum-reply-submit'));
        await waitFor(() =>
            expect(
                screen.queryByTestId('forum-reply-composer'),
                'a revoked viewer keeps no enabled composer from the stale cache',
            ).toBeNull(),
        );
        expect(
            screen.queryByText('Bringing potions.'),
            'the stale replies are no longer shown after the 403',
        ).toBeNull();
        expect(screen.getByRole('alert')).toHaveTextContent(DISCUSSION_FORBIDDEN);
    });
});

describe('signedUpLabel', () => {
    it('shows the cap when there is one', () => {
        expect(signedUpLabel({ signupCount: 18, maxAttendees: 40 })).toBe(
            '18 / 40 signed up',
        );
        expect(signedUpLabel({ signupCount: 3, maxAttendees: null })).toBe(
            '3 signed up',
        );
    });
});

describe('EventDiscussionSection', () => {
    function serveSummary(body: EventDiscussion): void {
        server.use(http.get(BASE, () => HttpResponse.json(body)));
    }

    it('the card CTA opens the panel on the event page', async () => {
        serveSummary(buildEventDiscussion());
        serveThread(thread());
        renderWithProviders(
            <EventDiscussionSection event={EVENT} enabled={true} />,
            { initialEntries: ['/events/42'] },
        );
        const cta = await screen.findByTestId('event-discussion-cta');
        expect(cta).toHaveAttribute('href', '/events/42?discussion=1');
        expect(screen.queryByTestId('event-discussion-panel')).toBeNull();
        await userEvent.click(cta);
        expect(
            await screen.findByTestId('event-discussion-panel'),
        ).toBeInTheDocument();
        expect(screen.queryByTestId('event-discussion-card')).toBeNull();
    });

    it('logged out with ?discussion=1: neither the panel nor a thread fetch', async () => {
        serveThread(thread());
        renderWithProviders(
            <EventDiscussionSection event={EVENT} enabled={false} />,
            { initialEntries: ['/events/42?discussion=1'] },
        );
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByTestId('event-discussion-panel')).toBeNull();
        expect(threadGets).toBe(0);
    });
});

describe('EventDiscussionPanel — opening post (ROK-2229)', () => {
    it('shows the Raid Ledger opening post, with the reply count above it, like the hub thread view', async () => {
        serveThread(thread({ body: 'Discussion for Molten Core. Open the event', replyCount: 1 }));
        renderPanel();
        const root = await screen.findByTestId('forum-thread-root');
        expect(within(root).getByTestId('forum-event-root-byline')).toHaveTextContent(/^Raid Ledger\s*Created when the event was scheduled · /);
        expect(within(root).getByTestId('forum-thread-root-body')).toHaveTextContent(/^Discussion for Molten Core, .+\. Signed-up players \(bench included\) can post here\.$/);
        expect(within(root).queryByText(/Open the event/)).toBeNull();
        const count = screen.getByTestId('forum-reply-count');
        expect(count).toHaveTextContent('1 reply');
        expect(count.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING, 'count precedes the root').not.toBe(0);
    });
});
