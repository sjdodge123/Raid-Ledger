/**
 * ROK-1483 — the panel's only decision is "is there a thread at all".
 *
 * The absent-thread case is the load-bearing one: a group with no forum post
 * must render NOTHING, not an empty shell, and must not issue a thread read
 * for a thread that does not exist.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import {
    createMockThreadMessage,
    createMockThreadPage,
    THREAD_MESSAGES_PATH,
    threadMessagesHandler,
} from '../../test/mocks/discord-thread-handlers';
import { LfgConversationPanel } from './LfgConversationPanel';

/** Records every thread read the panel triggers, with its query. */
function recordingHandler() {
    const requests: { threadId: string; surfaceId: string | null }[] = [];
    const handler = http.get(THREAD_MESSAGES_PATH, ({ params, request }) => {
        requests.push({
            threadId: String(params.threadId),
            surfaceId: new URL(request.url).searchParams.get('surfaceId'),
        });
        return HttpResponse.json(createMockThreadPage());
    });
    return { handler, requests };
}

describe('LfgConversationPanel', () => {
    it('renders nothing when the group has no forum thread', async () => {
        const { handler, requests } = recordingHandler();
        server.use(handler);

        const { container } = renderWithProviders(
            <LfgConversationPanel gameId={7} threadId={null} />,
        );

        expect(
            container.innerHTML,
            'a group with no thread must render no panel at all, not an empty shell',
        ).toBe('');
        expect(screen.queryByTestId('lfg-conversation-panel')).toBeNull();
        expect(screen.queryByTestId('threaded-chat-viewer')).toBeNull();
        expect(
            requests,
            'no thread id means no thread read',
        ).toHaveLength(0);
    });

    it('renders the panel and the viewer when a thread exists', async () => {
        server.use(
            threadMessagesHandler({
                messages: [
                    createMockThreadMessage({ content: 'see you at eight' }),
                ],
            }),
        );

        renderWithProviders(
            <LfgConversationPanel gameId={7} threadId="T1" />,
        );

        expect(
            screen.getByTestId('lfg-conversation-panel'),
        ).toBeInTheDocument();
        expect(screen.getByTestId('threaded-chat-viewer')).toBeInTheDocument();
        expect(
            await screen.findByText('see you at eight'),
        ).toBeInTheDocument();
    });

    it('titles the panel with the LFG surface copy', () => {
        renderWithProviders(
            <LfgConversationPanel gameId={7} threadId="T1" />,
        );

        expect(
            screen.getByRole('heading', { name: 'Conversation' }),
        ).toBeInTheDocument();
    });

    it('claims the lfg-group surface with the stringified game id', async () => {
        const { handler, requests } = recordingHandler();
        server.use(handler);

        renderWithProviders(
            <LfgConversationPanel gameId={42} threadId="T9" />,
        );

        await screen.findByTestId('thread-message-row');
        expect(
            requests[0],
            'the surface claim must name this game, or the API 403s the read (D3)',
        ).toEqual({ threadId: 'T9', surfaceId: '42' });
    });

    it('uses the theme surface token so both schemes stay readable (AC9)', () => {
        renderWithProviders(
            <LfgConversationPanel gameId={7} threadId="T1" />,
        );

        expect(
            screen.getByTestId('lfg-conversation-panel').className,
        ).toContain('bg-surface');
    });
});
