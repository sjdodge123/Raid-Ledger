/** ROK-1868 V2 — the inline composer (editor mocked by the Textarea fallback for speed). */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { axe } from 'vitest-axe';
import { HUB_POST_MARKDOWN_MESSAGES, type CreateHubPostInput } from '@raid-ledger/contract';
import type { MarkdownEditorProps as MarkdownEditorPropsShim } from '../../ui/markdown/lazy-markdown-editor';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubPost, buildHubPostComposer } from '../../../test/factories/hub-posts';
import { PostComposer } from './post-composer';

vi.mock('../../ui/markdown/lazy-markdown-editor', async () => {
    const { Textarea } = await import('../../ui/textarea');
    return {
        LazyMarkdownEditor: (p: MarkdownEditorPropsShim) => (
            <Textarea value={p.value} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testId} />
        ),
    };
});

const POSTS = 'http://localhost:3000/guilds/7/posts';

function renderComposer(onPosted = vi.fn(), isLeader = true) {
    const view = renderWithProviders(
        <PostComposer guildId={7} kind="wow_guild" isLeader={isLeader} onCancel={vi.fn()} onPosted={onPosted} />,
    );
    return { ...view, onPosted };
}

describe('PostComposer', () => {
    it('no channel linked → switch disabled, the reason is its description', async () => {
        server.use(http.get(`${POSTS}/composer`, () => HttpResponse.json(buildHubPostComposer({ channel: { state: 'unset' } }))));
        renderComposer();
        const hint = await screen.findByText('Link a Discord channel in Guild settings to post there.');
        const toggle = screen.getByRole('switch', { name: 'Also post to Discord' });
        expect(toggle).toBeDisabled();
        expect(toggle.getAttribute('aria-describedby')).toBe(hint.id);
    });

    it('starts at the remembered default; toggling off sends relayToDiscord:false', async () => {
        let sent: CreateHubPostInput | null = null;
        server.use(http.post(POSTS, async ({ request }) => {
            sent = (await request.json()) as CreateHubPostInput;
            return HttpResponse.json({ post: buildHubPost({ body: sent.body }), relayOutcome: 'not_requested' }, { status: 201 });
        }));
        const { onPosted } = renderComposer();
        const toggle = await screen.findByRole('switch', { name: 'Also post to Discord' });
        await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
        expect(screen.getByTestId('hub-post-submit')).toBeDisabled();
        await userEvent.type(screen.getByTestId('hub-post-body'), 'Raid tonight');
        await userEvent.click(toggle);
        await userEvent.click(screen.getByTestId('hub-post-submit'));
        await waitFor(() => expect(sent).toEqual({ body: 'Raid tonight', relayToDiscord: false }));
        await waitFor(() => expect(onPosted).toHaveBeenCalledWith(expect.objectContaining({ relayOutcome: 'not_requested' }), 'news'));
    });

    it('shows the HTML message before submit and keeps Post disabled', async () => {
        renderComposer();
        await userEvent.type(screen.getByTestId('hub-post-body'), '<b>x</b>');
        expect(await screen.findByText(HUB_POST_MARKDOWN_MESSAGES.html)).toBeInTheDocument();
        expect(screen.getByTestId('hub-post-submit')).toBeDisabled();
    });

    it('a 400 body error from the server shows inline', async () => {
        server.use(http.post(POSTS, () => HttpResponse.json({ body: ['Server refused the body.'] }, { status: 400 })));
        renderComposer();
        await userEvent.type(screen.getByTestId('hub-post-body'), 'Fine text');
        await userEvent.click(screen.getByTestId('hub-post-submit'));
        expect(await screen.findByText('Server refused the body.')).toBeInTheDocument();
    });

    it('is axe clean', async () => {
        const { container } = renderComposer();
        await screen.findByText('Posts to #news. Edits stay on Raid Ledger.');
        expect(await axe(container)).toHaveNoViolations();
    });
});
