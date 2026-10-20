/**
 * ROK-1868 V5 — the Posts tab: newest first, "Show older posts" pages, the
 * `?post=<id>` deep link (expanded + highlighted, fetched when not loaded,
 * 404 → "This post was removed."), and the phone delete confirm = BottomSheet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubPost } from '../../../test/factories/hub-posts';
import { HubPostsTab } from './posts-tab';

const media = { desktop: true };
vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => media.desktop }));

const POSTS = 'http://localhost:3000/guilds/7/posts';
const PAGE_1 = [buildHubPost({ id: 5, body: 'Fifth post' }), buildHubPost({ id: 4, body: 'Fourth post' })];
const PAGE_2 = [buildHubPost({ id: 3, body: 'Third post' })];

function serveFeed(): void {
    server.use(http.get(POSTS, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json(cursor ? { posts: PAGE_2, nextCursor: null } : { posts: PAGE_1, nextCursor: 'c1' });
    }));
}

function renderTab(path = '/guilds/7', canEdit = false) {
    return renderWithProviders(<HubPostsTab guildId={7} canEdit={canEdit} isLeader={canEdit} kind="wow_guild" />, { initialEntries: [path] });
}

function bodies(): string[] {
    return screen.getAllByTestId('hub-post-item').map((el) => within(el).getByTestId('hub-post-item-text').textContent ?? '');
}

beforeEach(() => { media.desktop = true; serveFeed(); });

describe('HubPostsTab (V5)', () => {
    it('lists posts newest first and loads older pages on demand', async () => {
        renderTab();
        expect(await screen.findByText('Fifth post')).toBeInTheDocument();
        expect(bodies(), 'the feed must keep the server order (newest first)').toEqual(['Fifth post', 'Fourth post']);
        await userEvent.click(screen.getByRole('button', { name: /show older posts/i }));
        expect(await screen.findByText('Third post')).toBeInTheDocument();
        expect(bodies()).toEqual(['Fifth post', 'Fourth post', 'Third post']);
        expect(screen.queryByRole('button', { name: /show older posts/i }), 'the last page offers no more').toBeNull();
    });

    it('?post=4 expands and highlights the loaded post', async () => {
        renderTab('/guilds/7?post=4');
        await screen.findByText('Fourth post');
        const item = screen.getByText('Fourth post').closest('article');
        expect(item, 'the linked post must be marked current').toHaveAttribute('aria-current', 'true');
        if (!item) throw new Error('linked post not rendered');
        expect(within(item).getByRole('button', { name: /show less/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('?post=3 fetches a post that is not on the first page and leads with it', async () => {
        server.use(http.get(`${POSTS}/3`, () => HttpResponse.json(buildHubPost({ id: 3, body: 'Third post' }))));
        renderTab('/guilds/7?post=3');
        const lead = await screen.findByTestId('hub-post-linked');
        expect(within(lead).getByText('Third post')).toBeInTheDocument();
        expect(within(lead).getByRole('article')).toHaveAttribute('aria-current', 'true');
    });

    it('a removed post (404) says so above the feed', async () => {
        server.use(http.get(`${POSTS}/9`, () => HttpResponse.json({ message: 'Not found' }, { status: 404 })));
        renderTab('/guilds/7?post=9');
        expect(await screen.findByText('This post was removed.')).toBeInTheDocument();
        expect(await screen.findByText('Fifth post'), 'the feed still renders below the notice').toBeInTheDocument();
    });

    it('shows an empty state when the hub has no posts', async () => {
        server.use(http.get(POSTS, () => HttpResponse.json({ posts: [], nextCursor: null })));
        renderTab();
        expect(await screen.findByTestId('hub-posts-empty')).toBeInTheDocument();
    });

    it('on a phone the delete confirm is a BottomSheet', async () => {
        media.desktop = false;
        renderTab('/guilds/7', true);
        await screen.findByText('Fifth post');
        const first = screen.getAllByTestId('hub-post-item')[0];
        if (!first) throw new Error('no post item rendered');
        await userEvent.click(within(first).getByRole('button', { name: /^delete/i }));
        expect(await screen.findByTestId('bottom-sheet-footer')).toBeInTheDocument();
        expect(screen.queryByTestId('modal-footer'), 'a phone must not get the desktop Modal').toBeNull();
        expect(screen.getByText(/This can’t be undone/)).toBeInTheDocument();
    });

    it('on desktop the delete confirm is a Modal and Delete calls the API', async () => {
        const deleted: string[] = [];
        server.use(http.delete(`${POSTS}/:postId`, ({ params }) => { deleted.push(String(params['postId'])); return new HttpResponse(null, { status: 204 }); }));
        renderTab('/guilds/7', true);
        await screen.findByText('Fifth post');
        const first = screen.getAllByTestId('hub-post-item')[0];
        if (!first) throw new Error('no post item rendered');
        await userEvent.click(within(first).getByRole('button', { name: /^delete/i }));
        expect(await screen.findByTestId('modal-footer')).toBeInTheDocument();
        await userEvent.click(screen.getByTestId('hub-post-delete-confirm'));
        await vi.waitFor(() => expect(deleted).toEqual(['5']));
    });
});
