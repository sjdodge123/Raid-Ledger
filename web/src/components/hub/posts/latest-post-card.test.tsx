/** ROK-1868 V3 — the Overview latest-post card. */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildProfile, HubPost } from '@raid-ledger/contract';
import type { MarkdownEditorProps } from '../../ui/markdown/lazy-markdown-editor';
import { server } from '../../../test/mocks/server';
import { createTestQueryClient, renderWithProviders } from '../../../test/render-helpers';
import type { JSX } from 'react';
import { useLocation } from 'react-router-dom';
import { buildHubPost } from '../../../test/factories/hub-posts';
import { LatestPostCard } from './latest-post-card';

vi.mock('../../ui/markdown/lazy-markdown-editor', async () => {
    const { Textarea } = await import('../../ui/textarea');
    return {
        LazyMarkdownEditor: (p: MarkdownEditorProps) => (
            <Textarea value={p.value} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testId} />
        ),
    };
});

const CORE = 'http://localhost:3000/guilds/7';

function withPosts(latest: HubPost | null, total: number): void {
    const profile: GuildProfile = { guildId: 7, gmPost: null, latestPost: latest, rules: [], links: [] };
    const posts = Array.from({ length: Math.min(total, 2) }, (_, i) => buildHubPost({ id: i + 1 }));
    server.use(
        http.get(`${CORE}/profile`, () => HttpResponse.json(profile)),
        http.get(`${CORE}/posts`, () => HttpResponse.json({ posts, nextCursor: null })),
    );
}

describe('LatestPostCard', () => {
    it('renders the markdown body (bold + list) with the byline', async () => {
        withPosts(buildHubPost(), 1);
        renderWithProviders(<LatestPostCard guildId={7} canEdit={false} isLeader={false} />);
        const body = await screen.findByTestId('guild-gm-post-body');
        expect(body.querySelector('strong')).toHaveTextContent('Raid night');
        expect(body.querySelectorAll('ul > li')).toHaveLength(2);
        expect(screen.getByTestId('guild-gm-post-byline')).toHaveTextContent('Grimtusk');
    });

    it('links "Previous posts" to the Posts tab once there are two posts', async () => {
        withPosts(buildHubPost(), 2);
        renderWithProviders(<LatestPostCard guildId={7} canEdit={false} isLeader={false} />);
        expect(await screen.findByTestId('hub-posts-previous')).toHaveAttribute('href', '#posts');
    });

    it('one post → no "Previous posts"; a member sees no Edit / New post', async () => {
        withPosts(buildHubPost(), 1);
        renderWithProviders(<LatestPostCard guildId={7} canEdit={false} isLeader={false} />);
        await screen.findByTestId('guild-gm-post-body');
        expect(screen.queryByTestId('hub-posts-previous')).toBeNull();
        expect(screen.queryByTestId('hub-post-edit')).toBeNull();
        expect(screen.queryByTestId('hub-post-new')).toBeNull();
    });

    it('renders nothing on a 403', async () => {
        let hit = false;
        server.use(http.get(`${CORE}/profile`, () => { hit = true; return HttpResponse.json({ message: 'no' }, { status: 403 }); }));
        const { container } = renderWithProviders(<LatestPostCard guildId={7} canEdit={false} isLeader={false} />);
        await waitFor(() => expect(hit).toBe(true));
        await waitFor(() => expect(container.querySelector('[data-testid="guild-gm-post"]')).toBeNull());
    });

    it('a failed relay leaves a warning status after posting', async () => {
        withPosts(buildHubPost(), 1);
        server.use(http.post(`${CORE}/posts`, () => HttpResponse.json({ post: buildHubPost({ id: 5 }), relayOutcome: 'failed' }, { status: 201 })));
        renderWithProviders(<LatestPostCard guildId={7} canEdit isLeader />);
        await userEvent.click(await screen.findByTestId('hub-post-new'));
        await userEvent.type(screen.getByTestId('hub-post-body'), 'Raid moved');
        await waitFor(() => expect(screen.getByTestId('hub-post-submit')).toBeEnabled());
        await userEvent.click(screen.getByTestId('hub-post-submit'));
        const status = await screen.findByRole('status');
        await waitFor(() => expect(status).toHaveTextContent('couldn’t be sent to Discord'));
        expect(status).toHaveClass('text-warning');
    });
});

function LocationProbe(): JSX.Element {
    const loc = useLocation();
    return <output data-testid="probe">{loc.search}</output>;
}

describe('LatestPostCard — review fixes (ROK-1868)', () => {
    it('keeps editing the post it opened when a refetch brings a newer one (Codex P1)', async () => {
        let latest = buildHubPost({ id: 4, body: 'Old plan' });
        const patched: string[] = [];
        server.use(
            http.get(`${CORE}/profile`, () => HttpResponse.json({ guildId: 7, gmPost: null, latestPost: latest, rules: [], links: [] })),
            http.get(`${CORE}/posts`, () => HttpResponse.json({ posts: [], nextCursor: null })),
            http.patch(`${CORE}/posts/:id`, ({ params }) => { patched.push(String(params['id'])); return HttpResponse.json(buildHubPost({ id: 4 })); }),
        );
        const queryClient = createTestQueryClient();
        renderWithProviders(<LatestPostCard guildId={7} canEdit isLeader />, { queryClient });
        await userEvent.click(await screen.findByTestId('hub-post-edit'));
        await userEvent.type(screen.getByTestId('hub-post-edit-body'), ' moved');
        latest = buildHubPost({ id: 9, body: 'Someone else' });
        await queryClient.refetchQueries();
        expect(screen.getByTestId('hub-post-edit-body'), 'the draft must survive the refetch').toHaveValue('Old plan moved');
        await userEvent.click(screen.getByTestId('hub-post-save'));
        await waitFor(() => expect(patched, 'Save must PATCH the post the editor opened, not the newer one').toEqual(['4']));
    });

    it('"Read the full post" navigates in-app to ?post=<id>#posts with a focus ring', async () => {
        const proto = HTMLElement.prototype;
        const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
        Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 999 });
        try {
            withPosts(buildHubPost({ id: 5 }), 1);
            renderWithProviders(<><LatestPostCard guildId={7} canEdit={false} isLeader={false} /><LocationProbe /></>);
            const link = await screen.findByRole('link', { name: 'Read the full post' });
            expect(link.className, 'the link carries the standard focus ring').toContain('focus-visible:');
            await userEvent.click(link);
            expect(screen.getByTestId('probe'), 'the router (not a document reload) carries ?post=').toHaveTextContent('?post=5');
            expect(window.location.hash).toBe('#posts');
        } finally {
            if (scroll) Object.defineProperty(proto, 'scrollHeight', scroll);
            window.location.hash = '';
        }
    });
});
