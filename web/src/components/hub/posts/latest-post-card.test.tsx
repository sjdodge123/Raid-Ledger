/** ROK-1868 V3 — the Overview latest-post card. */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { GuildProfile, HubPost } from '@raid-ledger/contract';
import type { MarkdownEditorProps } from '../../ui/markdown/lazy-markdown-editor';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
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
