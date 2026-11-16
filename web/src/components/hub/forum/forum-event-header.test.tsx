/**
 * ROK-2226 — the event header above an event thread (chip → `/events/<id>`,
 * Cancelled pill, read-only line per reason), the row pills, and the thread
 * view's composer following the server's `canReply` over the tab's `canWrite`.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { HubForumLockReason, HubForumThread } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumLock, buildForumThreadDetail, buildForumThreadEvent } from '../../../test/factories/hub-forum';
import type { MarkdownEditorProps } from '../../ui/markdown/lazy-markdown-editor';
import { ForumEventHeader, ForumEventPills, eventShortDate, lockReasonCopy } from './forum-event-header';
import { HubForumTab } from './forum-tab';

vi.mock('../../ui/markdown/lazy-markdown-editor', async () => {
    const { Textarea } = await import('../../ui/textarea');
    return {
        LazyMarkdownEditor: (p: MarkdownEditorProps) => (
            <Textarea value={p.value} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testId} />
        ),
    };
});

const THREAD = 'http://localhost:3000/guilds/7/forum/5';
const EVENT = buildForumThreadEvent();

describe('ForumEventHeader (ROK-2226 §7.1)', () => {
    it('shows the event date and links back to the event page', () => {
        renderWithProviders(<ForumEventHeader event={EVENT} lock={null} />);
        expect(screen.getByTestId('forum-event-header')).toHaveTextContent(eventShortDate(EVENT.startTime));
        expect(screen.getByTestId('forum-event-link')).toHaveAttribute('href', '/events/42');
        expect(screen.queryByText('Cancelled')).toBeNull();
        expect(screen.queryByTestId('forum-lock-bar')).toBeNull();
    });

    it('marks a cancelled event', () => {
        renderWithProviders(<ForumEventHeader event={buildForumThreadEvent({ cancelled: true })} lock={null} />);
        expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });

    it.each<[HubForumLockReason, string]>([
        ['event-ended', 'Closed 24 h after the event ended'],
        ['event-detached', 'This event moved to another hub'],
        ['event-deleted', 'This event was deleted'],
    ])('locked (%s) shows the read-only line "%s"', (reason, copy) => {
        renderWithProviders(<ForumEventHeader event={EVENT} lock={buildForumLock({ reason })} />);
        expect(lockReasonCopy(reason)).toBe(copy);
        const bar = screen.getByTestId('forum-lock-bar');
        expect(bar).toHaveTextContent('Discussion closed');
        expect(bar).toHaveTextContent(copy);
    });
});

describe('ForumEventPills (ROK-2226 Q3)', () => {
    it('renders nothing for a normal thread', () => {
        const { container } = renderWithProviders(<ForumEventPills event={null} lock={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows "Event · <date>", and Closed once locked', () => {
        const { rerender } = renderWithProviders(<ForumEventPills event={EVENT} lock={null} />);
        expect(screen.getByText(`Event · ${eventShortDate(EVENT.startTime)}`)).toBeInTheDocument();
        expect(screen.queryByText('Closed')).toBeNull();
        rerender(<ForumEventPills event={EVENT} lock={buildForumLock()} />);
        expect(screen.getByText('Closed')).toBeInTheDocument();
    });
});

describe('ForumThreadView on an event thread (ROK-2226 §7.1)', () => {
    function renderEventThread(thread: HubForumThread, canWrite: boolean) {
        server.use(http.get(THREAD, () => HttpResponse.json(thread)));
        return renderWithProviders(<HubForumTab guildId={7} canWrite={canWrite} kind="wow_guild" />, { initialEntries: ['/hubs/7?thread=5#forum'] });
    }

    it('hides the composer when the server says canReply is false, even for a member', async () => {
        renderEventThread(buildForumThreadDetail({ event: EVENT, lock: null, canReply: false }), true);
        expect(await screen.findByTestId('forum-event-header')).toBeInTheDocument();
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });

    it('shows the composer when canReply is true, even if the tab would not', async () => {
        renderEventThread(buildForumThreadDetail({ event: EVENT, lock: null, canReply: true }), false);
        expect(await screen.findByTestId('forum-reply-composer')).toBeInTheDocument();
    });

    it('a locked event thread shows the lock line and no composer', async () => {
        renderEventThread(buildForumThreadDetail({ event: EVENT, lock: buildForumLock(), canReply: false }), true);
        expect(await screen.findByTestId('forum-lock-bar')).toHaveTextContent('Closed 24 h after the event ended');
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });
});
