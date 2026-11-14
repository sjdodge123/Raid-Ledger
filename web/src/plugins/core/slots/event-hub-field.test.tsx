/**
 * ROK-2071 — the Core "Hub" field on the event form: lists every hub kind the
 * viewer may tag (`GET /guilds/taggable`), hides when there are none, reports
 * the pick into the submit DTO, and renders with the WoW plugin inactive.
 * Ports the ROK-1787 / ROK-1817 assertions of the retired WoW Guild field.
 */
import { createElement, useState, type ReactNode } from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { CORE_PLUGIN_ID, type TaggableHub } from '@raid-ledger/contract';
import { server } from '../../../test/mocks/server';
import { usePluginStore } from '../../../stores/plugin-store';
import { PluginSlot } from '../../plugin-slot';
import { getSlotRegistrations } from '../../plugin-registry';
import { guildIdForSubmit } from '../../../components/events/create-event-form.utils';
import { EventHubField, UNLISTED_HUB_LABEL } from './event-hub-field';
import '../register';
import '../../wow/register';

vi.mock('../../../hooks/use-auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../hooks/use-auth')>()),
    useAuth: () => ({ user: { id: 1, role: 'member' }, isAuthenticated: true }),
    useViewerCacheScope: () => 1,
}));

const API = 'http://localhost:3000/guilds/taggable';

function hub(id: number, name: string, kind: TaggableHub['kind']): TaggableHub {
    return { id, gameId: 7, kind, name, crest: null };
}

const CREW = hub(21, 'Seed Crew', 'game_community');
const SERVER = hub(22, 'Seed Server', 'game_server');
const GUILD = hub(11, 'Iron Vanguard', 'wow_guild');

let lastGameId: string | null = null;

function serve(hubs: TaggableHub[]): void {
    server.use(http.get(API, ({ request }) => {
        lastGameId = new URL(request.url).searchParams.get('gameId');
        return HttpResponse.json({ hubs });
    }));
}

let lastClient: QueryClient | null = null;

function wrapper(): (p: { children: ReactNode }) => ReactNode {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    lastClient = client;
    return ({ children }) => createElement(QueryClientProvider, { client }, children);
}

function renderField(guildId: number | null, onGuildChange = vi.fn(), dropUnlisted = false): ReturnType<typeof vi.fn> {
    render(<EventHubField gameId={7} guildId={guildId} onGuildChange={onGuildChange} dropUnlisted={dropUnlisted} />, { wrapper: wrapper() });
    return onGuildChange;
}

/** Waits until the taggable lookup has RESOLVED (not merely been requested) and the field re-rendered. */
async function settled(): Promise<void> {
    await waitFor(() => expect(lastClient?.getQueryCache().getAll()[0]?.state.status, 'the taggable lookup resolved').toBe('success'));
    await act(async () => {});
}

afterEach(() => { lastGameId = null; lastClient = null; });

describe('EventHubField (ROK-2071)', () => {
    it('lists hubs of every kind after a "None" option, labelled Hub', async () => {
        serve([GUILD, CREW, SERVER]);
        renderField(null);
        const select = await screen.findByLabelText('Hub');
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
        expect(options, 'a WoW guild, a community hub and a server hub are all taggable').toEqual(['None', 'Iron Vanguard', 'Seed Crew', 'Seed Server']);
        expect(screen.getByText('Shows this event on the hub page')).toBeInTheDocument();
        expect(lastGameId).toBe('7');
    });

    it('renders nothing when the viewer may tag no hub of this game', async () => {
        serve([]);
        renderField(null);
        await settled();
        expect(lastGameId).toBe('7');
        expect(screen.queryByTestId('event-hub-field'), 'an empty list must hide the Hub field').toBeNull();
    });

    it('reports the picked hub, and null for None', async () => {
        serve([CREW]);
        const onGuildChange = renderField(null);
        const select = await screen.findByLabelText('Hub');
        await userEvent.selectOptions(select, '21');
        expect(onGuildChange).toHaveBeenLastCalledWith(21);
        await userEvent.selectOptions(select, '');
        expect(onGuildChange).toHaveBeenLastCalledWith(null);
    });

    it('edit: tagging an untagged event to a community hub sends that hub id on save', async () => {
        serve([GUILD, CREW]);
        let picked: number | null = null;
        function Harness() {
            const [guildId, setGuildId] = useState<number | null>(null);
            picked = guildId;
            return <EventHubField gameId={7} guildId={guildId} onGuildChange={setGuildId} />;
        }
        render(<Harness />, { wrapper: wrapper() });
        await userEvent.selectOptions(await screen.findByLabelText('Hub'), '21');
        await waitFor(() => expect(picked).toBe(21));
        expect(guildIdForSubmit(picked, true, null), 'the save DTO must carry the community hub').toEqual({ guildId: 21 });
    });
});

describe('EventHubField — registered by Core, not WoW', () => {
    it('Core is the only owner of the event-form hub slot', () => {
        const owners = getSlotRegistrations('event-create:hub-field').map((r) => r.pluginSlug);
        expect(owners, 'one picker, owned by Core').toEqual([CORE_PLUGIN_ID]);
    });

    it('renders through the slot with the WoW (blizzard) plugin inactive', async () => {
        act(() => usePluginStore.setState({ activeSlugs: new Set([CORE_PLUGIN_ID]) }));
        serve([CREW]);
        render(<PluginSlot name="event-create:hub-field" context={{ gameId: 7, guildId: null, onGuildChange: vi.fn(), dropUnlisted: false }} />, { wrapper: wrapper() });
        expect(await screen.findByLabelText('Hub'), 'the Hub field must not need the WoW plugin').toBeInTheDocument();
    });
});

describe('EventHubField — a crafted ?guildId= (ROK-1817)', () => {
    it('create mode: clears a preselected hub absent from the taggable list', async () => {
        serve([CREW]);
        const onGuildChange = renderField(42, vi.fn(), true);
        await waitFor(() => expect(onGuildChange, 'a hub absent from the picker must be dropped').toHaveBeenCalledWith(null));
    });

    it('create mode: clears a preselected hub when the list is empty (field hidden)', async () => {
        serve([]);
        const onGuildChange = renderField(21, vi.fn(), true);
        await waitFor(() => expect(onGuildChange, 'an untaggable hub must not ride along unseen').toHaveBeenCalledWith(null));
        expect(screen.queryByTestId('event-hub-field')).toBeNull();
    });

    it('create mode: keeps a preselected hub the viewer may tag', async () => {
        serve([CREW]);
        const onGuildChange = renderField(21, vi.fn(), true);
        expect(await screen.findByLabelText('Hub')).toHaveValue('21');
        expect(onGuildChange).not.toHaveBeenCalled();
    });

    it('create mode: a failed lookup keeps the preselected hub', async () => {
        server.use(http.get(API, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const onGuildChange = vi.fn();
        render(<EventHubField gameId={7} guildId={21} onGuildChange={onGuildChange} dropUnlisted />, {
            wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
        });
        await waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.status).toBe('error'));
        await act(async () => {});
        expect(onGuildChange, 'a transient lookup error must not drop a valid pick').not.toHaveBeenCalled();
    });

    it('edit mode: leaves an unchanged tag alone (the submit omits it)', async () => {
        serve([SERVER]);
        const onGuildChange = renderField(21);
        const select = await screen.findByLabelText('Hub');
        await settled();
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
        expect(options, 'the list the edit form settled on').toEqual(['None', UNLISTED_HUB_LABEL, 'Seed Server']);
        expect(onGuildChange, 'edit mode must not clear a tag absent from the list').not.toHaveBeenCalled();
    });
});

describe('EventHubField — edit-mode stand-in for a tagged hub the viewer cannot list', () => {
    it('edit mode: an event tagged to a hub the viewer cannot list keeps that hub selected, as a stand-in option', async () => {
        serve([SERVER]);
        renderField(21);
        const select = await screen.findByLabelText('Hub');
        await settled();
        expect(select, 'the field must show the current tag, not "None"').toHaveValue('21');
        const current = select.querySelector('option[value="21"]');
        expect(current?.textContent, 'the unlisted hub gets a generic label').toBe('Current hub (not in your list)');
        expect(current, 'the stand-in carries the current tag').toBeInTheDocument();
    });

    it('edit mode: the stand-in stays after switching away, so the viewer can switch back to the original tag', async () => {
        serve([SERVER]);
        let picked: number | null = 21;
        function Harness() {
            const [guildId, setGuildId] = useState<number | null>(21);
            picked = guildId;
            return <EventHubField gameId={7} guildId={guildId} onGuildChange={setGuildId} />;
        }
        render(<Harness />, { wrapper: wrapper() });
        const select = await screen.findByLabelText('Hub');
        await settled();
        await userEvent.selectOptions(select, '22');
        await waitFor(() => expect(picked).toBe(22));
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.textContent);
        expect(options, 'the opened-with hub must still be offered after switching away').toEqual(['None', UNLISTED_HUB_LABEL, 'Seed Server']);
        await userEvent.selectOptions(select, '21');
        await waitFor(() => expect(picked, 'switching back restores the original tag').toBe(21));
        expect(guildIdForSubmit(picked, true, 21), 'an unchanged tag is omitted from the save DTO').toEqual({});
    });

    it('edit mode: no stand-in once the form switches to another game (its hub is not that game\'s — the api would 400)', async () => {
        serve([SERVER]);
        const { rerender } = render(<EventHubField gameId={7} guildId={21} onGuildChange={vi.fn()} />, { wrapper: wrapper() });
        await screen.findByLabelText('Hub');
        await settled();
        expect(screen.getByText(UNLISTED_HUB_LABEL), 'offered while the game is the opened one').toBeInTheDocument();
        rerender(<EventHubField gameId={8} guildId={null} onGuildChange={vi.fn()} />);
        await waitFor(() => expect(lastGameId, 'the new game\'s hubs were fetched').toBe('8'));
        await act(async () => {});
        expect(screen.getByLabelText('Hub'), 'the new game still lists a hub').toBeInTheDocument();
        expect(screen.queryByText(UNLISTED_HUB_LABEL), 'the opened-with hub belongs to the old game').toBeNull();
    });

    it('edit mode: no stand-in while the hub list is loading', () => {
        server.use(http.get(API, () => new Promise<never>(() => undefined)));
        renderField(21);
        expect(screen.queryByText(UNLISTED_HUB_LABEL), 'an unproven list cannot show the stand-in').toBeNull();
    });

    it('edit mode: no stand-in once a refetch of the hub list fails', async () => {
        server.use(http.get(API, () => HttpResponse.json({ message: 'boom' }, { status: 500 })));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        client.setQueryData(['guilds', 'taggable', 7, 1], { hubs: [SERVER] }, { updatedAt: 0 });
        render(<EventHubField gameId={7} guildId={21} onGuildChange={vi.fn()} />, {
            wrapper: ({ children }) => createElement(QueryClientProvider, { client }, children),
        });
        await waitFor(() => expect(client.getQueryCache().getAll()[0]?.state.status, 'the stale-list refetch failed').toBe('error'));
        await act(async () => {});
        expect(screen.getByLabelText('Hub'), 'the cached list still renders').toBeInTheDocument();
        expect(screen.queryByText(UNLISTED_HUB_LABEL), 'a failed lookup cannot prove the hub is absent').toBeNull();
    });
});
