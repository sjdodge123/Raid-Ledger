/**
 * ROK-1175 — the Forum tab's list view: pinned group first (Pinned pill),
 * the activity feed, "Load older threads", the Q2 empty state, deleted
 * placeholders (AC6) and the row → `?thread=<id>#forum` link.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type { HubForumThreadList } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumThread } from '../../../test/factories/hub-forum';
import { HubForumTab } from './forum-tab';

const FORUM = 'http://localhost:3000/guilds/7/forum';
const PINNED = [buildForumThread({ id: 9, title: 'Read me first', pinnedAt: '2026-11-13T09:00:00.000Z' })];
const PAGE_1 = [buildForumThread({ id: 5, title: 'Raid comp', replyCount: 1 }), buildForumThread({ id: 4, title: 'Loot rules' })];
const PAGE_2 = [buildForumThread({ id: 3, title: 'Old idea' })];

function serve(first: HubForumThreadList): void {
    server.use(http.get(FORUM, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json(cursor ? { pinned: [], threads: PAGE_2, nextCursor: null } : first);
    }));
}

function Where(): JSX.Element {
    const loc = useLocation();
    return <output data-testid="where">{`${loc.search}${loc.hash}`}</output>;
}

function renderTab(path = '/hubs/7#forum') {
    return renderWithProviders(<><HubForumTab guildId={7} canWrite kind="wow_guild" /><Where /></>, { initialEntries: [path] });
}

function titles(): string[] {
    return screen.getAllByTestId('forum-thread-row').map((el) => within(el).getByTestId('forum-thread-title').textContent ?? '');
}

beforeEach(() => serve({ pinned: PINNED, threads: PAGE_1, nextCursor: 'c1' }));

describe('HubForumTab list (ROK-1175)', () => {
    it('lists the pinned group first with a Pinned pill, then the feed in server order', async () => {
        renderTab();
        expect(await screen.findByText('Read me first')).toBeInTheDocument();
        expect(titles(), 'pinned threads lead the list (AC5)').toEqual(['Read me first', 'Raid comp', 'Loot rules']);
        const pinnedRow = screen.getAllByTestId('forum-thread-row')[0];
        expect(pinnedRow && within(pinnedRow).queryByText('Pinned'), 'a pinned row carries the Pinned pill').not.toBeNull();
        const feedRow = screen.getAllByTestId('forum-thread-row')[1];
        expect(feedRow && within(feedRow).queryByText('Pinned'), 'a feed row has no Pinned pill').toBeNull();
        expect(feedRow && within(feedRow).getByText('1 reply')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Pinned' })).toBeInTheDocument();
    });

    it('loads older threads on demand and stops at the last page', async () => {
        renderTab();
        await userEvent.click(await screen.findByRole('button', { name: /load older threads/i }));
        expect(await screen.findByText('Old idea')).toBeInTheDocument();
        expect(titles()).toEqual(['Read me first', 'Raid comp', 'Loot rules', 'Old idea']);
        expect(screen.queryByRole('button', { name: /load older threads/i }), 'the last page offers no more').toBeNull();
    });

    it('opens a thread through the row action (?thread=<id>#forum)', async () => {
        renderTab();
        await userEvent.click(await screen.findByRole('button', { name: 'Open thread: Raid comp' }));
        expect(screen.getByTestId('where').textContent).toBe('?thread=5#forum');
    });

    it('shows "Start the first thread" on an empty forum (Q2)', async () => {
        serve({ pinned: [], threads: [], nextCursor: null });
        renderTab();
        expect(await screen.findByText('Start the first thread')).toBeInTheDocument();
        expect(screen.queryAllByTestId('forum-thread-row')).toHaveLength(0);
    });

    it('renders a removed thread as its placeholder, never its title (AC6, Q8)', async () => {
        serve({ pinned: [], threads: [buildForumThread({ id: 6, title: '', preview: '', deleted: 'moderator', replyCount: 3 })], nextCursor: null });
        renderTab();
        expect(await screen.findByText(/Removed by a moderator/)).toBeInTheDocument();
        expect(screen.getByText(/3 replies are still readable/)).toBeInTheDocument();
    });

    it('offers New thread to a member: a toolbar button (≥768px) and the phone FAB', async () => {
        renderTab();
        expect(await screen.findAllByRole('button', { name: /new thread/i }), 'toolbar button + FAB').toHaveLength(2);
    });

    it('offers no New thread without write access', async () => {
        renderWithProviders(<HubForumTab guildId={7} canWrite={false} kind="wow_guild" />, { initialEntries: ['/hubs/7#forum'] });
        expect(await screen.findByText('Read me first')).toBeInTheDocument();
        expect(screen.queryAllByRole('button', { name: /new thread/i })).toHaveLength(0);
    });
});
