/**
 * ROK-1175 — the `?thread=<id>` view: root + flat replies (Q4), reply paging,
 * Edited mark, removed placeholders (AC6), the `can`-driven menu (Q5 edit,
 * officer pin), delete confirm, the reply composer (members on live threads
 * only — AC7, Q8) and the new-thread composer (title 1..120).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import type { HubForumThread } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumReply, buildForumThreadDetail } from '../../../test/factories/hub-forum';
import type { MarkdownEditorProps } from '../../ui/markdown/lazy-markdown-editor';
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
const ALL = { edit: true, delete: true, pin: true };
const ALL_REPLY = { edit: true, delete: true, pin: false };
const calls: string[] = [];

function serveThread(first: HubForumThread, older: HubForumThread | null = null): void {
    server.use(http.get(THREAD, ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('replyCursor');
        return HttpResponse.json(cursor && older ? older : first);
    }));
}

function Where(): JSX.Element {
    const loc = useLocation();
    return <output data-testid="where">{`${loc.search}${loc.hash}`}</output>;
}

function renderThread(canWrite = true, path = '/hubs/7?thread=5#forum') {
    return renderWithProviders(<><HubForumTab guildId={7} canWrite={canWrite} kind="wow_guild" /><Where /></>, { initialEntries: [path] });
}

beforeEach(() => {
    calls.length = 0;
    server.use(
        http.put(`${THREAD}/pin`, () => { calls.push('PUT pin'); return new HttpResponse(null, { status: 204 }); }),
        http.delete(THREAD, () => { calls.push('DELETE thread'); return new HttpResponse(null, { status: 204 }); }),
    );
});

describe('ForumThreadView (ROK-1175)', () => {
    it('shows the root, its replies oldest first and the Edited mark', async () => {
        serveThread(buildForumThreadDetail({ title: 'Raid comp', editedAt: '2026-11-14T09:30:00.000Z',
            replies: [buildForumReply({ id: 11, body: 'first' }), buildForumReply({ id: 12, body: 'second' })] }));
        renderThread();
        expect(await screen.findByTestId('forum-thread-heading')).toHaveTextContent('Raid comp');
        expect(within(screen.getByTestId('forum-thread-root')).getByTestId('forum-edited')).toBeInTheDocument();
        expect(screen.getAllByTestId('forum-reply').map((r) => r.textContent ?? ''), 'replies oldest first (Q4)').toEqual([
            expect.stringContaining('first'), expect.stringContaining('second'),
        ]);
    });

    it('pages replies with "Show more replies", with the reply box already showing', async () => {
        serveThread(buildForumThreadDetail({ nextReplyCursor: 'r1' }), buildForumThreadDetail({ replies: [buildForumReply({ id: 13, body: 'newer' })] }));
        renderThread();
        expect(await screen.findByTestId('forum-reply-composer'), 'the composer does not wait for every page').toBeInTheDocument();
        await userEvent.click(await screen.findByRole('button', { name: 'Show more replies' }));
        expect(await screen.findByText('newer')).toBeInTheDocument();
        expect(screen.getAllByTestId('forum-reply')).toHaveLength(2);
        expect(screen.getByTestId('forum-reply-composer')).toBeInTheDocument();
    });

    it('renders a removed reply as its placeholder, never its text (AC6)', async () => {
        serveThread(buildForumThreadDetail({ replies: [buildForumReply({ body: '', deleted: 'moderator' })] }));
        renderThread();
        expect(await screen.findByText('Removed by a moderator')).toBeInTheDocument();
    });

    it('hides the reply composer and every menu from a visitor (AC7)', async () => {
        serveThread(buildForumThreadDetail());
        renderThread(false);
        expect(await screen.findByTestId('forum-thread-root')).toBeInTheDocument();
        expect(screen.queryByTestId('forum-reply-composer'), 'no composer without write access').toBeNull();
        expect(screen.queryByTestId('forum-thread-actions'), 'no menu when can is all false').toBeNull();
    });

    it('hides the reply composer on a removed thread (Q8)', async () => {
        serveThread(buildForumThreadDetail({ deleted: 'author', title: '', body: '' }));
        renderThread();
        expect(await screen.findByText('Deleted by the author')).toBeInTheDocument();
        expect(screen.queryByTestId('forum-reply-composer')).toBeNull();
    });

    it('offers only Delete when the edit window has closed (Q5)', async () => {
        serveThread(buildForumThreadDetail({ can: { edit: false, delete: true, pin: false } }));
        renderThread();
        await userEvent.click(await screen.findByTestId('forum-thread-actions'));
        expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Delete']);
    });

    it('pins through the menu (officer) and deletes after the confirm', async () => {
        serveThread(buildForumThreadDetail({ can: ALL }));
        renderThread();
        await userEvent.click(await screen.findByTestId('forum-thread-actions'));
        expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Pin', 'Edit', 'Delete']);
        await userEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
        await userEvent.click(screen.getByTestId('forum-thread-actions'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        await userEvent.click(await screen.findByTestId('forum-delete-confirm'));
        await screen.findByText(/./, { selector: '[data-testid="forum-thread-heading"]' });
        expect(calls, 'PUT /pin then DELETE the thread').toEqual(['PUT pin', 'DELETE thread']);
    });
});

describe('ForumThreadComposer (ROK-1175)', () => {
    it('blocks an over-long title, then posts and opens the new thread', async () => {
        server.use(
            http.get('http://localhost:3000/guilds/7/forum', () => HttpResponse.json({ pinned: [], threads: [], nextCursor: null })),
            http.post('http://localhost:3000/guilds/7/forum', () => HttpResponse.json(buildForumThreadDetail({ id: 42 }), { status: 201 })),
        );
        serveThread(buildForumThreadDetail());
        renderThread(true, '/hubs/7#forum');
        await userEvent.click((await screen.findAllByRole('button', { name: /new thread/i }))[0] ?? document.body);
        await userEvent.click(screen.getByTestId('forum-title-input'));
        await userEvent.paste('x'.repeat(121));
        await userEvent.type(await screen.findByTestId('forum-body-input'), 'Body');
        expect(screen.getByTestId('forum-thread-submit'), 'a 121-char title cannot post').toBeDisabled();
        expect(screen.getByTestId('forum-title-count')).toHaveTextContent('121/120');
        await userEvent.clear(screen.getByTestId('forum-title-input'));
        await userEvent.type(screen.getByTestId('forum-title-input'), 'Loot rules');
        expect(screen.getByTestId('forum-thread-submit'), 'a valid title + body can post').toBeEnabled();
        await userEvent.click(screen.getByTestId('forum-thread-submit'));
        expect(await screen.findByText('?thread=42#forum', { selector: '[data-testid="where"]' })).toBeInTheDocument();
    });
});

describe('Forum reply edit + delete, and the row Edit link (ROK-1175)', () => {
    it('saves an in-place reply edit with the new body and shows the Edited mark', async () => {
        let body = '';
        let edited = false;
        server.use(
            http.get(THREAD, () => HttpResponse.json(buildForumThreadDetail({
                replies: [buildForumReply({ can: ALL_REPLY, body: edited ? body : 'old text', editedAt: edited ? '2026-11-14T11:00:00.000Z' : null })],
            }))),
            http.patch(`${THREAD}/replies/11`, async ({ request }) => {
                body = ((await request.json()) as { body: string }).body;
                edited = true;
                return HttpResponse.json(buildForumReply({ body, editedAt: '2026-11-14T11:00:00.000Z' }));
            }),
        );
        renderThread();
        await userEvent.click(await screen.findByTestId('forum-reply-actions'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
        await userEvent.clear(screen.getByTestId('forum-edit-body'));
        await userEvent.type(screen.getByTestId('forum-edit-body'), 'new text');
        await userEvent.click(screen.getByTestId('forum-edit-save'));
        const reply = await screen.findByTestId('forum-edited');
        expect(body, 'PATCH carries the edited body').toBe('new text');
        expect(reply.closest('[data-testid="forum-reply"]')).toHaveTextContent('new text');
    });

    it('deletes a reply through the menu and the confirm', async () => {
        serveThread(buildForumThreadDetail({ replies: [buildForumReply({ can: ALL_REPLY })] }));
        server.use(http.delete(`${THREAD}/replies/11`, () => { calls.push('DELETE reply'); return new HttpResponse(null, { status: 204 }); }));
        renderThread();
        await userEvent.click(await screen.findByTestId('forum-reply-actions'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        await userEvent.click(await screen.findByTestId('forum-delete-confirm'));
        await vi.waitFor(() => expect(calls, 'DELETE the reply, not the thread').toEqual(['DELETE reply']));
    });

    it('opens the root in the editor from a row Edit link (&edit=1), and Cancel drops the flag', async () => {
        serveThread(buildForumThreadDetail({ can: { edit: true, delete: true, pin: false } }));
        renderThread(true, '/hubs/7?thread=5&edit=1#forum');
        expect(await screen.findByTestId('forum-message-editor')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('where')).toHaveTextContent('?thread=5#forum');
    });
});

describe('Forum ?reply= deep link + posting past the loaded pages (ROK-1175 D9)', () => {
    const original = Element.prototype.scrollIntoView;
    const scrolled: string[] = [];
    beforeEach(() => {
        scrolled.length = 0;
        Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); };
        return () => { Element.prototype.scrollIntoView = original; };
    });

    it('pages through to an off-page ?reply= target, rings it and scrolls it into view', async () => {
        serveThread(buildForumThreadDetail({ nextReplyCursor: 'r1' }), buildForumThreadDetail({ replies: [buildForumReply({ id: 13, body: 'deep' })] }));
        renderThread(true, '/hubs/7?thread=5&reply=13#forum');
        const target = (await screen.findByText('deep')).closest('article');
        expect(target?.getAttribute('aria-current'), 'reply 13 is the ringed deep-link target').toBe('true');
        await vi.waitFor(() => expect(scrolled, 'scrollIntoView ran on reply 13').toEqual(['forum-reply-13']));
    });

    it('shows a just-posted reply that lands beyond the loaded pages', async () => {
        serveThread(buildForumThreadDetail({ nextReplyCursor: 'r1' }), buildForumThreadDetail({ replies: [buildForumReply({ id: 13, body: 'my reply' })] }));
        server.use(http.post(`${THREAD}/replies`, () => HttpResponse.json(buildForumReply({ id: 13, body: 'my reply' }), { status: 201 })));
        renderThread();
        await userEvent.type(await screen.findByTestId('forum-reply-input'), 'my reply');
        expect(screen.queryByText('my reply', { selector: '[data-testid="forum-reply-body"] *' }), 'page 2 not loaded yet').toBeNull();
        await userEvent.click(screen.getByTestId('forum-reply-submit'));
        expect(await screen.findByText('?thread=5&reply=13#forum', { selector: '[data-testid="where"]' })).toBeInTheDocument();
        const mine = await vi.waitFor(() => {
            const el = document.getElementById('forum-reply-13');
            expect(el, 'the posted reply is rendered without "Show more replies"').not.toBeNull();
            return el;
        });
        expect(mine).toHaveTextContent('my reply');
    });
});

describe('Forum discard guards (ROK-1175)', () => {
    it('asks before Cancel drops an in-place edit with changes', async () => {
        serveThread(buildForumThreadDetail({ replies: [buildForumReply({ can: ALL_REPLY, body: 'old text' })] }));
        renderThread();
        await userEvent.click(await screen.findByTestId('forum-reply-actions'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
        await userEvent.type(screen.getByTestId('forum-edit-body'), ' more');
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(await screen.findByTestId('discard-changes-confirm'), 'a changed edit asks first').toBeInTheDocument();
        await userEvent.click(screen.getByTestId('discard-changes-keep'));
        expect(screen.getByTestId('forum-edit-body'), 'Keep leaves the draft').toHaveValue('old text more');
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await userEvent.click(await screen.findByTestId('discard-changes-discard'));
        expect(screen.queryByTestId('forum-message-editor'), 'Discard closes the editor').toBeNull();
    });

    it('holds an in-hub tab link while a new-thread draft is dirty', async () => {
        server.use(http.get('http://localhost:3000/guilds/7/forum', () => HttpResponse.json({ pinned: [], threads: [], nextCursor: null })));
        window.location.hash = '#forum';
        renderWithProviders(<><HubForumTab guildId={7} canWrite kind="wow_guild" /><a href="#overview">Overview</a></>, { initialEntries: ['/hubs/7#forum'] });
        await userEvent.click((await screen.findAllByRole('button', { name: /new thread/i }))[0] ?? document.body);
        await userEvent.type(screen.getByTestId('forum-title-input'), 'Draft');
        await userEvent.click(screen.getByRole('link', { name: 'Overview' }));
        expect(await screen.findByTestId('discard-changes-confirm'), 'the tab switch is held').toBeInTheDocument();
        expect(window.location.hash, 'the hash did not move yet').toBe('#forum');
        await userEvent.click(screen.getByTestId('discard-changes-keep'));
        expect(screen.getByTestId('forum-title-input'), 'Keep leaves the draft').toHaveValue('Draft');
        await userEvent.click(screen.getByRole('link', { name: 'Overview' }));
        await userEvent.click(await screen.findByTestId('discard-changes-discard'));
        expect(window.location.hash, 'Discard applies the held tab').toBe('#overview');
        expect(screen.queryByTestId('hub-forum-composer'), 'and drops the draft').toBeNull();
        window.location.hash = '';
    });
});
