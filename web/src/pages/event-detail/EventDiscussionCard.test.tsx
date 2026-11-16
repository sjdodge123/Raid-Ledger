/**
 * ROK-2226 — the event page Discussion card, one test per spec §7 state:
 * hidden (logged out, untagged, hidden hub, `none`, error), empty, replies +
 * Join, can-read-cannot-reply, header + count only, and locked (each reason).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type {
    EventDiscussion,
    HubForumLockReason,
} from '@raid-ledger/contract';
import { server } from '../../test/mocks/server';
import { renderWithProviders } from '../../test/render-helpers';
import {
    buildEventDiscussion,
    buildForumLock,
    buildForumReply,
} from '../../test/factories/hub-forum';
import { lockReasonCopy } from '../../components/hub/forum/forum-event-header';
import {
    DISCUSSION_EMPTY,
    DISCUSSION_SIGN_UP,
    EventDiscussionCard,
    type EventDiscussionCardProps,
} from './EventDiscussionCard';

const SUMMARY = 'http://localhost:3000/events/42/discussion';
const THREAD_HREF = '/hubs/7?thread=5#forum';
const EVENT: EventDiscussionCardProps['event'] = {
    id: 42,
    guildId: 7,
    hub: { id: 7, name: 'Hearthbound', kind: 'wow_guild' },
};
let calls = 0;

function serve(body: EventDiscussion): void {
    server.use(
        http.get(SUMMARY, () => {
            calls += 1;
            return HttpResponse.json(body);
        }),
    );
}

function renderCard(props: Partial<EventDiscussionCardProps> = {}) {
    return renderWithProviders(
        <EventDiscussionCard event={EVENT} enabled={true} {...props} />,
    );
}

async function settled(): Promise<void> {
    await waitFor(() => expect(calls).toBe(1));
    await waitFor(() =>
        expect(screen.queryByLabelText('Loading discussion')).toBeNull(),
    );
}

const THREE = [
    buildForumReply({
        id: 21,
        body: 'Bringing Fire Protection potions.',
        author: { userId: 3, displayName: 'Kaelith', avatarUrl: null },
    }),
    buildForumReply({
        id: 22,
        body: 'Waterlords run Friday?',
        author: { userId: 4, displayName: 'Thrallbro', avatarUrl: null },
    }),
    buildForumReply({
        id: 23,
        body: 'Count me in.',
        author: { userId: 5, displayName: 'Mirelle', avatarUrl: null },
    }),
];

beforeEach(() => {
    calls = 0;
});

describe('EventDiscussionCard — hidden (ROK-2226 §7)', () => {
    it.each<[string, Partial<EventDiscussionCardProps>]>([
        ['logged out', { enabled: false }],
        ['untagged event', { event: { ...EVENT, guildId: null } }],
        ['hidden or inactive hub', { event: { ...EVENT, hub: null } }],
    ])('renders nothing and never fetches when %s', async (_label, props) => {
        serve(buildEventDiscussion());
        renderCard(props);
        await new Promise((r) => setTimeout(r, 0));
        expect(screen.queryByTestId('event-discussion-card')).toBeNull();
        expect(screen.queryByLabelText('Loading discussion')).toBeNull();
        expect(calls).toBe(0);
    });

    it('renders nothing when the event has no discussion', async () => {
        serve({ state: 'none' });
        renderCard();
        await settled();
        expect(screen.queryByTestId('event-discussion-card')).toBeNull();
    });

    it('renders nothing when the summary request fails', async () => {
        server.use(
            http.get(SUMMARY, () => {
                calls += 1;
                return HttpResponse.json({ message: 'boom' }, { status: 500 });
            }),
        );
        renderCard();
        await settled();
        expect(screen.queryByTestId('event-discussion-card')).toBeNull();
    });
});

describe('EventDiscussionCard — visible states (ROK-2226 §7)', () => {
    it('empty thread: the empty line and Join the discussion', async () => {
        serve(buildEventDiscussion({ replyCount: 0, latestReplies: [] }));
        renderCard();
        expect(await screen.findByText(DISCUSSION_EMPTY)).toBeInTheDocument();
        expect(screen.getByTestId('event-discussion-count')).toHaveTextContent(
            '0 replies',
        );
        const cta = screen.getByTestId('event-discussion-cta');
        expect(cta).toHaveTextContent('Join the discussion');
        expect(cta).toHaveAttribute('href', THREAD_HREF);
    });

    it('signed-up viewer: three replies oldest first, the count and Join the discussion', async () => {
        serve(buildEventDiscussion({ replyCount: 12, latestReplies: THREE }));
        renderCard();
        const rows = await screen.findAllByTestId('event-discussion-reply');
        expect(rows).toHaveLength(3);
        expect(rows[0]).toHaveTextContent('Kaelith');
        expect(rows[1]).toHaveTextContent('Thrallbro');
        expect(rows[2]).toHaveTextContent('Mirelle');
        expect(rows[0]).toHaveTextContent('Bringing Fire Protection potions.');
        expect(screen.getByTestId('event-discussion-count')).toHaveTextContent(
            '12 replies',
        );
        expect(screen.getByTestId('event-discussion-cta')).toHaveTextContent(
            'Join the discussion',
        );
        expect(screen.queryByTestId('event-discussion-signup-note')).toBeNull();
        expect(screen.queryByTestId('forum-lock-bar')).toBeNull();
    });

    it('member not signed up: replies, the sign-up note and Read the full thread', async () => {
        serve(
            buildEventDiscussion({
                replyCount: 3,
                latestReplies: THREE,
                can: { read: true, reply: false },
            }),
        );
        renderCard();
        expect(
            await screen.findAllByTestId('event-discussion-reply'),
        ).toHaveLength(3);
        expect(
            screen.getByTestId('event-discussion-signup-note'),
        ).toHaveTextContent(DISCUSSION_SIGN_UP);
        const cta = screen.getByTestId('event-discussion-cta');
        expect(cta).toHaveTextContent('Read the full thread');
        expect(cta).toHaveAttribute('href', THREAD_HREF);
    });

    it('cannot read (visitor, not signed up): header and count only', async () => {
        serve(
            buildEventDiscussion({
                replyCount: 4,
                latestReplies: [],
                can: { read: false, reply: false },
            }),
        );
        renderCard();
        expect(
            await screen.findByTestId('event-discussion-card'),
        ).toHaveTextContent('Discussion');
        expect(screen.getByTestId('event-discussion-count')).toHaveTextContent(
            '4 replies',
        );
        expect(screen.queryByTestId('event-discussion-reply')).toBeNull();
        expect(screen.queryByText(DISCUSSION_EMPTY)).toBeNull();
        expect(screen.queryByTestId('event-discussion-cta')).toBeNull();
    });

    it.each<HubForumLockReason>([
        'event-ended',
        'event-detached',
        'event-deleted',
    ])(
        'locked (%s): Closed pill, the reason line and Read the full thread, never Join',
        async (reason) => {
            serve(
                buildEventDiscussion({
                    replyCount: 3,
                    latestReplies: THREE,
                    lock: buildForumLock({ reason }),
                    can: { read: true, reply: true },
                }),
            );
            renderCard();
            const card = await screen.findByTestId('event-discussion-card');
            expect(within(card).getByText('Closed')).toBeInTheDocument();
            expect(screen.getByTestId('forum-lock-bar')).toHaveTextContent(
                lockReasonCopy(reason),
            );
            expect(
                screen.getByTestId('event-discussion-cta'),
            ).toHaveTextContent('Read the full thread');
            expect(screen.queryByText('Join the discussion')).toBeNull();
            expect(
                screen.queryByTestId('event-discussion-signup-note'),
            ).toBeNull();
        },
    );
});
