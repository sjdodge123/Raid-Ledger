/**
 * ROK-1175 — the Forum list row's "⋯" menu (`forum-row-actions`): the author
 * gets Edit + Delete (Edit opens the thread in edit mode), a moderator gets
 * Pin + Delete, a plain member who is not the author gets no menu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import { server } from '../../../test/mocks/server';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumThread } from '../../../test/factories/hub-forum';
import { HubForumTab } from './forum-tab';

const auth = vi.hoisted(() => ({ userId: 1 }));
vi.mock('../../../hooks/use-auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../hooks/use-auth')>();
    return { ...actual, useAuth: () => ({ user: { id: auth.userId, role: 'member' }, isAuthenticated: true }) };
});

const FORUM = 'http://localhost:3000/guilds/7/forum';
const calls: string[] = [];

function Where(): JSX.Element {
    const loc = useLocation();
    return <output data-testid="where">{`${loc.search}${loc.hash}`}</output>;
}

/** One live thread by user 1, created just now (inside the 24 h edit window). */
function renderList(viewerId: number, canModerate: boolean) {
    auth.userId = viewerId;
    const thread = buildForumThread({ id: 5, title: 'Raid comp', createdAt: new Date().toISOString() });
    server.use(http.get(FORUM, () => HttpResponse.json({ pinned: [], threads: [thread], nextCursor: null })));
    return renderWithProviders(<><HubForumTab guildId={7} canWrite canModerate={canModerate} kind="wow_guild" /><Where /></>,
        { initialEntries: ['/hubs/7#forum'] });
}

async function menuLabels(): Promise<string[]> {
    await userEvent.click(await screen.findByTestId('forum-row-actions'));
    return screen.getAllByRole('menuitem').map((m) => m.textContent ?? '');
}

beforeEach(() => {
    calls.length = 0;
    server.use(
        http.put(`${FORUM}/5/pin`, () => { calls.push('PUT pin'); return new HttpResponse(null, { status: 204 }); }),
        http.delete(`${FORUM}/5`, () => { calls.push('DELETE thread'); return new HttpResponse(null, { status: 204 }); }),
    );
});

describe('Forum list row actions (ROK-1175)', () => {
    it('gives the author Edit + Delete, and Edit opens the thread in edit mode', async () => {
        renderList(1, false);
        expect(await menuLabels(), 'author inside 24 h: no Pin').toEqual(['Edit', 'Delete']);
        await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
        expect(screen.getByTestId('where')).toHaveTextContent('?thread=5&edit=1#forum');
    });

    it('gives a moderator Pin + Delete, pins, and deletes after the confirm', async () => {
        renderList(99, true);
        expect(await menuLabels(), 'moderator never edits another member’s text').toEqual(['Pin', 'Delete']);
        await userEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
        await userEvent.click(screen.getByTestId('forum-row-actions'));
        await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
        await userEvent.click(await screen.findByTestId('forum-delete-confirm'));
        await vi.waitFor(() => expect(calls, 'PUT /pin then DELETE the thread').toEqual(['PUT pin', 'DELETE thread']));
    });

    it('shows no menu to a plain member who is not the author', async () => {
        renderList(2, false);
        expect(await screen.findByTestId('forum-thread-row')).toBeInTheDocument();
        expect(screen.queryByTestId('forum-row-actions'), 'no rights → no ⋯ trigger').toBeNull();
    });
});
