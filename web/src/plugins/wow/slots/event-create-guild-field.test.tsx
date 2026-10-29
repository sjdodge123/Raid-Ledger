/**
 * ROK-1787 — the event form's Guild field: shown only to editors of a guild
 * of the chosen game, lists only editable guilds, reports the pick.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import type { MyGuild } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { EventCreateGuildField } from './event-create-guild-field';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
    useViewerCacheScope: () => 1,
}));

const API = 'http://localhost:3000/plugins/wow/guilds';

function guild(id: number, name: string, canEdit: boolean): MyGuild {
    return {
        id, gameId: 7, kind: 'wow_guild', name, region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde',
        memberCount: 3, lastSnapshotAt: null, rankIndex: 1, rankName: 'Officer', canEdit, gmPostHeadline: null,
    };
}

let lastGameId: string | null = null;

function serve(guilds: MyGuild[]): void {
    server.use(http.get(API, ({ request }) => {
        lastGameId = new URL(request.url).searchParams.get('gameId');
        return HttpResponse.json({ guilds });
    }));
}

function renderField(guildId: number | null, onGuildChange = vi.fn(), dropUnlisted = false): ReturnType<typeof vi.fn> {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    render(<EventCreateGuildField gameId={7} guildId={guildId} onGuildChange={onGuildChange} dropUnlisted={dropUnlisted} />, { wrapper });
    return onGuildChange;
}

describe('EventCreateGuildField (ROK-1787)', () => {
    it('renders nothing when the viewer edits no guild of this game', async () => {
        serve([guild(11, 'Iron Vanguard', false)]);
        renderField(null);
        await waitFor(() => expect(lastGameId).toBe('7'));
        expect(screen.queryByTestId('event-guild-field'), 'a plain member must not see the Guild field').toBeNull();
    });

    it('lists only editable guilds after a "None" option', async () => {
        serve([guild(11, 'Iron Vanguard', true), guild(12, 'Dusk Wardens', false)]);
        renderField(null);
        const select = await screen.findByLabelText('Guild');
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
        expect(options).toEqual(['None', 'Iron Vanguard']);
        expect(screen.getByText('Shows this event on the guild page')).toBeInTheDocument();
    });

    it('reports the picked guild, and null for None', async () => {
        serve([guild(11, 'Iron Vanguard', true)]);
        const onGuildChange = renderField(null);
        const select = await screen.findByLabelText('Guild');
        await userEvent.selectOptions(select, '11');
        expect(onGuildChange).toHaveBeenLastCalledWith(11);
        await userEvent.selectOptions(select, '');
        expect(onGuildChange).toHaveBeenLastCalledWith(null);
    });
});

describe('EventCreateGuildField — a crafted ?guildId= (ROK-1817)', () => {
    it('create mode: clears a preselected guild the viewer cannot edit (member only)', async () => {
        serve([guild(11, 'Iron Vanguard', false)]);
        const onGuildChange = renderField(11, vi.fn(), true);
        await waitFor(() => expect(onGuildChange, 'an uneditable guild must not ride along unseen').toHaveBeenCalledWith(null));
        expect(screen.queryByTestId('event-guild-field')).toBeNull();
    });

    it('create mode: clears a guild missing from an editor\'s list (another guild)', async () => {
        serve([guild(11, 'Iron Vanguard', true)]);
        const onGuildChange = renderField(42, vi.fn(), true);
        await waitFor(() => expect(onGuildChange, 'a guild absent from the picker must be dropped').toHaveBeenCalledWith(null));
    });

    it('create mode: keeps a preselected guild the viewer edits', async () => {
        serve([guild(11, 'Iron Vanguard', true)]);
        const onGuildChange = renderField(11, vi.fn(), true);
        expect(await screen.findByLabelText('Guild')).toHaveValue('11');
        expect(onGuildChange).not.toHaveBeenCalled();
    });

    it('create mode: a failed guild lookup keeps the preselected guild', async () => {
        server.use(http.get(API, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
        const onGuildChange = vi.fn();
        render(<EventCreateGuildField gameId={7} guildId={11} onGuildChange={onGuildChange} dropUnlisted />, { wrapper });
        await waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error'));
        await act(async () => {});
        expect(onGuildChange, 'a transient lookup error must not drop a valid pick').not.toHaveBeenCalled();
    });

    it('edit mode: leaves an unchanged tag alone (the submit omits it)', async () => {
        serve([guild(11, 'Iron Vanguard', false)]);
        const onGuildChange = renderField(11);
        await waitFor(() => expect(lastGameId).toBe('7'));
        expect(onGuildChange).not.toHaveBeenCalled();
    });
});
