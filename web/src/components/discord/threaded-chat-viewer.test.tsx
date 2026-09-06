/**
 * ROK-1483 — the viewer renders a mirrored thread and can never write to it.
 *
 * Driven through MSW rather than a mocked hook: the viewer owns its own data
 * (AC6), so a mocked hook would test a component that does not exist. Every
 * case here therefore also exercises the API client and the Zod parse.
 *
 * NOTE ON SELECTORS: the folder-wide guard (`read-only.guard.test.ts`) scans
 * THIS file too, and its forbidden list includes the angle-bracket forms of the
 * write affordances. The AC4 selector below is a CSS selector — bare element
 * names, no angle brackets — so it states the assertion without tripping the
 * guard. Do not "tidy" it into JSX-looking strings.
 */
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ThreadSurfaceRef } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { server } from '../../test/mocks/server';
import {
    createMockThreadMessage,
    pagedThreadMessagesHandler,
    threadMessagesHandler,
} from '../../test/mocks/discord-thread-handlers';
import {
    ThreadedChatViewer,
    type ThreadedChatViewerProps,
} from './threaded-chat-viewer';

const SURFACE: ThreadSurfaceRef = { kind: 'lfg-group', id: '7' };

/**
 * AC6 — the props are exactly `{ threadId, surface }`.
 *
 * This copy is DOCUMENTATION ONLY: `web/tsconfig.app.json` excludes
 * `src/**\/*.test.tsx`, so nothing typechecks this file — neither `tsc -b` nor
 * vitest, which transpiles without checking. The pin that actually fails the
 * build when a third prop appears is `ThreadedChatViewerPropsPin`, exported
 * from `threaded-chat-viewer.tsx`. Keep both: this one says what the rule is
 * where a reader looks for it, that one enforces it.
 */
type Expect<T extends true> = T;
type Equal<A, B> =
    (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
        ? true
        : false;
export type _PropsPin = Expect<
    Equal<keyof ThreadedChatViewerProps, 'threadId' | 'surface'>
>;

function renderViewer(): ReturnType<typeof renderWithProviders> {
    return renderWithProviders(
        <ThreadedChatViewer threadId="T1" surface={SURFACE} />,
    );
}

describe('ThreadedChatViewer', () => {
    it('renders each mirrored message with its frozen author name', async () => {
        server.use(
            threadMessagesHandler({
                messages: [
                    createMockThreadMessage({
                        messageId: '1',
                        content: 'first one',
                        author: {
                            discordUserId: '9',
                            displayName: 'Alice Bee',
                            avatarUrl: null,
                        },
                    }),
                    createMockThreadMessage({
                        messageId: '2',
                        content: 'second one',
                    }),
                ],
            }),
        );
        renderViewer();

        expect(await screen.findByText('first one')).toBeInTheDocument();
        expect(screen.getByText('second one')).toBeInTheDocument();
        expect(screen.getAllByTestId('thread-message-row')).toHaveLength(2);
        expect(screen.getAllByText('Alice Bee').length).toBeGreaterThan(0);
    });

    it('says where the conversation lives when the thread has no replies', async () => {
        server.use(threadMessagesHandler({ messages: [] }));
        renderViewer();

        expect(
            await screen.findByTestId('thread-empty'),
        ).toHaveTextContent(
            'No replies yet — the conversation happens in Discord.',
        );
        expect(screen.queryAllByTestId('thread-message-row')).toHaveLength(0);
    });

    it('shows a loading state before the first page resolves', () => {
        renderViewer();

        expect(screen.getByTestId('thread-loading')).toBeInTheDocument();
        // The empty copy must NOT flash while the first page is in flight —
        // "no replies" and "not loaded yet" are different statements.
        expect(screen.queryByTestId('thread-empty')).toBeNull();
    });

    it('links out to Discord when the thread is still there', async () => {
        server.use(
            threadMessagesHandler({
                threadUrl: 'https://discord.com/channels/1/T1',
            }),
        );
        renderViewer();

        // The header renders during loading too (stable layout), where the
        // link is inert because no url is known yet — so wait for the page.
        await screen.findByTestId('thread-message-row');
        const link = screen.getByTestId('thread-open-in-discord');
        expect(
            link.tagName,
            'a live thread must offer a real anchor, not the inert loading text',
        ).toBe('A');
        expect(link).toHaveAttribute(
            'href',
            'https://discord.com/channels/1/T1',
        );
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        expect(link).toHaveAttribute('target', '_blank');
    });

    it('renders the Discord link as inert text once the thread is gone (D12)', async () => {
        server.use(
            threadMessagesHandler({
                threadUrl: null,
                messages: [
                    createMockThreadMessage({ content: 'history survives' }),
                ],
            }),
        );
        const { container } = renderViewer();

        expect(await screen.findByText('history survives')).toBeInTheDocument();
        const openInDiscord = screen.getByTestId('thread-open-in-discord');
        expect(
            openInDiscord.tagName,
            'a thread Discord no longer has must degrade to text, not a dead anchor',
        ).toBe('SPAN');
        expect(container.querySelector('a')).toBeNull();
    });

    it('marks an archived thread without hiding it (D12)', async () => {
        server.use(
            threadMessagesHandler({
                archived: true,
                messages: [createMockThreadMessage({ content: 'still here' })],
            }),
        );
        renderViewer();

        expect(await screen.findByTestId('thread-archived')).toHaveTextContent(
            '(archived)',
        );
        expect(screen.getByText('still here')).toBeInTheDocument();
    });

    it('pages backwards from the oldest message on screen', async () => {
        const { handler, cursors } = pagedThreadMessagesHandler(
            {
                hasMore: true,
                messages: [
                    createMockThreadMessage({
                        messageId: '500',
                        content: 'newest page',
                    }),
                ],
            },
            {
                hasMore: false,
                messages: [
                    createMockThreadMessage({
                        messageId: '100',
                        content: 'older page',
                    }),
                ],
            },
        );
        server.use(handler);
        renderViewer();

        await userEvent.click(await screen.findByTestId('thread-load-older'));

        expect(await screen.findByText('older page')).toBeInTheDocument();
        await waitFor(() =>
            expect(
                cursors,
                'load-older must send the oldest message on screen as the before cursor',
            ).toContain('500'),
        );
    });

    it('offers no pager once the whole thread is on screen', async () => {
        server.use(threadMessagesHandler({ hasMore: false }));
        renderViewer();

        await screen.findByTestId('thread-message-row');
        expect(screen.queryByTestId('thread-load-older')).toBeNull();
    });

    it('AC4 — renders no write affordance at all', async () => {
        server.use(
            threadMessagesHandler({
                hasMore: true,
                messages: [createMockThreadMessage({ content: 'read me' })],
            }),
        );
        const { container } = renderViewer();

        await screen.findByText('read me');
        const writeAffordances = ['input', 'textarea', 'form'].join(', ');
        expect(
            container.querySelectorAll(writeAffordances),
            'the Discord viewer is read-only (AC4/D15) — nothing here may accept typing',
        ).toHaveLength(0);
        expect(
            container.querySelectorAll('[contenteditable]'),
        ).toHaveLength(0);
        expect(
            container.querySelectorAll('button[type=submit]'),
        ).toHaveLength(0);
    });
});
