/**
 * ROK-1787 — the event form's Guild field: shown only to editors of a guild
 * of the chosen game, lists only editable guilds, reports the pick.
 */
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
        id, gameId: 7, name, region: 'us', realmSlug: 'whitemane', realmName: null, faction: 'horde',
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

function renderField(guildId: number | null, onGuildChange = vi.fn()): ReturnType<typeof vi.fn> {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
    render(<EventCreateGuildField gameId={7} guildId={guildId} onGuildChange={onGuildChange} />, { wrapper });
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
