/**
 * ROK-1868 W5 (Codex r3) — the deep-linked post is keyed by its id, so moving
 * in-app from one cached older post to another resets its edit / delete state
 * instead of retargeting it at the new post.
 */
import { useState, type JSX } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubPost } from '../../../test/factories/hub-posts';
import { LinkedPost } from './linked-post';

vi.mock('../../../hooks/use-media-query', () => ({ useMediaQuery: () => true }));

const POSTS = 'http://localhost:3000/guilds/7/posts';

function Harness(): JSX.Element {
    const [postId, setPostId] = useState(2);
    return (
        <>
            <button type="button" onClick={() => setPostId(2)}>go to post 2</button>
            <button type="button" onClick={() => setPostId(3)}>go to post 3</button>
            <LinkedPost guildId={7} postId={postId} canEdit removedCopy="This post was removed." />
        </>
    );
}

describe('LinkedPost (Codex r3)', () => {
    it('an open delete confirm does not carry over to the next deep-linked post', async () => {
        server.use(
            http.get(`${POSTS}/3`, () => HttpResponse.json(buildHubPost({ id: 3, body: 'Third post' }))),
            http.get(`${POSTS}/2`, () => HttpResponse.json(buildHubPost({ id: 2, body: 'Second post' }))),
        );
        renderWithProviders(<Harness />);
        await screen.findByText('Second post'); // post 2 is now cached
        await userEvent.click(screen.getByRole('button', { name: 'go to post 3' }));
        await screen.findByText('Third post');
        await userEvent.click(screen.getByRole('button', { name: /^delete/i }));
        expect(await screen.findByTestId('hub-post-delete-confirm')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'go to post 2' }));
        await screen.findByText('Second post');
        expect(screen.queryByTestId('hub-post-delete-confirm'), 'the delete confirm opened for post 3 must not retarget post 2').toBeNull();
    });
});
