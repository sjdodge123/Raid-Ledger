/**
 * ROK-2229 — an event thread in the hub Forum matches the approved mockup:
 * "<title> — <date>" heading with a bare "Event" pill, "N / M signed up" in
 * the event header, the reply count ABOVE the opening post, and a Raid Ledger
 * opening post rendered client-side. A normal thread keeps its old layout.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { HubForumThread } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumReply, buildForumThread, buildForumThreadDetail, buildForumThreadEvent } from '../../../test/factories/hub-forum';
import { HubForumTab } from './forum-tab';
import { ForumThreadRow } from './forum-thread-row';
import { SPLIT_DAY_END, SPLIT_DAY_START, VIEWER_ZONE, pinViewerZone, shortDateIn, timeIn } from '../../../test/tz-helpers';

const THREAD = 'http://localhost:3000/guilds/7/forum/5';
/**
 * m1/B1 (ROK-2229 review): a non-UTC viewer zone and an instant on different
 * calendar days there and in UTC; expectations use an explicit `timeZone`.
 */
const ZONE = VIEWER_ZONE;
const START = SPLIT_DAY_START;
pinViewerZone();

it('uses an instant whose New York and UTC dates differ', () => {
    // Sun 22 Nov 21:30 in New York (EST, UTC-5); Mon 23 Nov 02:30 in UTC.
    expect(shortDateIn(START, ZONE)).toContain('22');
    expect(shortDateIn(START, 'UTC')).toContain('23');
});

const EVENT = buildForumThreadEvent({ startTime: START, endTime: SPLIT_DAY_END, signupCount: 18, maxAttendees: 40 });

function renderThread(thread: HubForumThread): void {
    server.use(http.get(THREAD, () => HttpResponse.json(thread)));
    renderWithProviders(<HubForumTab guildId={7} canWrite kind="wow_guild" />, { initialEntries: ['/hubs/7?thread=5#forum'] });
}

function eventThread(overrides: Partial<HubForumThread> = {}): HubForumThread {
    return buildForumThreadDetail({
        title: 'Molten Core', body: 'Discussion for Molten Core. Open the event', event: EVENT, lock: null,
        replyCount: 2, replies: [buildForumReply({ id: 11, body: 'first' })], ...overrides,
    });
}

/** True when `a` comes before `b` in document order. */
function precedes(a: HTMLElement, b: HTMLElement): boolean {
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('event thread view (ROK-2229)', () => {
    it('titles the thread "<title> — <short date>" with a bare Event pill', async () => {
        renderThread(eventThread());
        const heading = await screen.findByTestId('forum-thread-heading');
        expect(heading).toHaveTextContent(`Molten Core — ${shortDateIn(START, ZONE)}`);
        expect(screen.getByText('Event')).toBeInTheDocument();
        expect(screen.queryByText(/^Event ·/), 'the heading pill drops the date the title already shows').toBeNull();
    });

    it('shows "N / M signed up" in the event header', async () => {
        renderThread(eventThread());
        expect(await screen.findByTestId('forum-event-signups')).toHaveTextContent('18 / 40 signed up');
    });

    it('reads "N signed up" when the event has no cap', async () => {
        renderThread(eventThread({ event: { ...EVENT, maxAttendees: null } }));
        expect(await screen.findByTestId('forum-event-signups')).toHaveTextContent(/^18 signed up$/);
    });

    it('omits the signup fact when the payload has no count', async () => {
        renderThread(eventThread({ event: buildForumThreadEvent() }));
        await screen.findByTestId('forum-event-header');
        expect(screen.queryByTestId('forum-event-signups')).toBeNull();
    });

    it('opens with a Raid Ledger post rendered in the viewer timezone, not the stored body', async () => {
        renderThread(eventThread());
        const root = await screen.findByTestId('forum-thread-root');
        expect(within(root).getByTestId('forum-event-root-byline')).toHaveTextContent(/^Raid Ledger\s*Created when the event was scheduled · /);
        expect(within(root).getByTestId('forum-thread-root-body')).toHaveTextContent(
            `Discussion for Molten Core, ${shortDateIn(START, ZONE)} ${timeIn(START, ZONE)}. Signed-up players (bench included) can post here.`,
        );
        expect(within(root).queryByText(/Open the event/)).toBeNull();
        expect(within(root).queryByText('Grimtusk'), 'the creator is not the byline').toBeNull();
    });

    it('puts "N replies" above the opening post', async () => {
        renderThread(eventThread());
        const root = await screen.findByTestId('forum-thread-root');
        const count = screen.getByTestId('forum-reply-count');
        expect(count).toHaveTextContent('2 replies');
        expect(precedes(count, root)).toBe(true);
    });

    it('keeps a normal thread as it was: author byline, stored body, count below the root', async () => {
        renderThread(buildForumThreadDetail({ title: 'Raid comp', replyCount: 2 }));
        const root = await screen.findByTestId('forum-thread-root');
        expect(screen.getByTestId('forum-thread-heading')).toHaveTextContent(/^Raid comp$/);
        expect(within(root).queryByTestId('forum-event-root-byline')).toBeNull();
        expect(precedes(root, screen.getByTestId('forum-reply-count'))).toBe(true);
    });
});

describe('event thread list row (ROK-2229)', () => {
    const viewer = { userId: 1, canWrite: true, canModerate: false };

    it('shows the dated title, a calendar avatar and "Event thread · <age>"', () => {
        const thread = buildForumThread({ title: 'Molten Core', event: EVENT, lock: null });
        renderWithProviders(<ul><ForumThreadRow guildId={7} thread={thread} viewer={viewer} /></ul>);
        const row = screen.getByTestId('forum-thread-row');
        expect(within(row).getByTestId('forum-thread-title')).toHaveTextContent(`Molten Core — ${shortDateIn(START, ZONE)}`);
        expect(within(row).getByTestId('forum-thread-event-avatar')).toBeInTheDocument();
        expect(within(row).getByText(/^Event thread · /)).toBeInTheDocument();
        expect(within(row).queryByText(/^Grimtusk ·/)).toBeNull();
    });

    it("previews the newest reply as \"<author>: <text>\" instead of the root", () => {
        const latestReply = { author: { userId: 9, displayName: 'Mirelle', avatarUrl: null }, preview: 'Count me in.' };
        const thread = buildForumThread({ title: 'Molten Core', preview: 'Discussion for Molten Core. Open the event', event: EVENT, lock: null, latestReply });
        renderWithProviders(<ul><ForumThreadRow guildId={7} thread={thread} viewer={viewer} /></ul>);
        const row = screen.getByTestId('forum-thread-row');
        expect(within(row).getByText('Mirelle: Count me in.')).toBeInTheDocument();
        expect(within(row).queryByText(/Open the event/)).toBeNull();
    });

    it('leaves a normal row titled and attributed as before', () => {
        renderWithProviders(<ul><ForumThreadRow guildId={7} thread={buildForumThread({ title: 'Raid comp' })} viewer={viewer} /></ul>);
        const row = screen.getByTestId('forum-thread-row');
        expect(within(row).getByTestId('forum-thread-title')).toHaveTextContent(/^Raid comp$/);
        expect(within(row).queryByTestId('forum-thread-event-avatar')).toBeNull();
    });
});
