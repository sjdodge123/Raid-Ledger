/**
 * ROK-2215 W5 (form half) + W7 — a plan link's pre-selected dungeon seeds the
 * form exactly like a manual pick (content-browser selection + Dungeon event
 * type auto-picked), and its characters show a "Will invite" line above the
 * footer that "Don't invite" clears.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EventResponseDto } from '@raid-ledger/contract';
import { CreateEventForm } from './create-event-form';
import { useCreateEventMutation } from './use-create-event-mutation';

window.HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock('react-router-dom', async () => ({ ...(await vi.importActual('react-router-dom')), useNavigate: () => vi.fn() }));
vi.mock('../../lib/api-client', () => ({ createEvent: vi.fn(), updateEvent: vi.fn(), inviteCharacters: vi.fn() }));
vi.mock('./use-create-event-mutation', async (orig) => {
    const actual = await orig<typeof import('./use-create-event-mutation')>();
    return { ...actual, useCreateEventMutation: vi.fn(actual.useCreateEventMutation) };
});
vi.mock('../../lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('../../stores/timezone-store', () => ({
    useTimezoneStore: vi.fn((sel: (s: { resolved: string }) => unknown) => sel({ resolved: 'America/New_York' })),
}));
vi.mock('../../lib/timezone-utils', () => ({ getTimezoneAbbr: vi.fn(() => 'EST') }));
vi.mock('../../hooks/use-event-templates', () => ({
    useEventTemplates: vi.fn(() => ({ data: null })),
    useCreateTemplate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
    useDeleteTemplate: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({ games: [{ id: 5, name: 'WoW Forever', slug: 'wow-forever' }] })),
    useEventTypes: vi.fn(() => ({ data: { data: [
        { id: 7, name: 'Raid', slug: 'raid', defaultPlayerCap: 10 },
        { id: 8, name: 'Dungeon', slug: 'dungeon', defaultPlayerCap: 5 },
    ] } })),
}));
vi.mock('../../hooks/use-want-to-play', () => ({ useWantToPlay: vi.fn(() => ({ count: 0, isLoading: false })) }));
// The content-browser slot echoes what it was handed, so the test sees the selection the chip renders from.
vi.mock('../../plugins', () => ({
    PluginSlot: vi.fn(({ name, context }: { name: string; context: { contentType: string; selectedInstances: Array<{ name: string }> } }) => (
        name !== 'event-create:content-browser' ? null
            : <div data-testid="content-browser" data-type={context.contentType}>{context.selectedInstances.map((i) => i.name).join(',')}</div>
    )),
}));
vi.mock('../../plugins/wow/utils', () => ({
    getWowVariant: vi.fn(() => 'wow_forever'),
    getContentType: vi.fn((slug: string) => (slug === 'dungeon' || slug === 'raid' ? slug : null)),
}));
vi.mock('./game-search-input', () => ({ GameSearchInput: vi.fn(() => <div data-testid="game-search-input" />) }));

const GAME = { id: 5, name: 'WoW Forever', slug: 'wow-forever', coverUrl: null };
const WC = { id: 90000004, name: 'Wailing Caverns', shortName: 'WC', category: 'dungeon', minimumLevel: 15, maximumLevel: 25 };
const IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];

function renderForm(props: Parameters<typeof CreateEventForm>[0]) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><MemoryRouter><CreateEventForm {...props} /></MemoryRouter></QueryClientProvider>);
}

describe('CreateEventForm — plan dungeon prefill (ROK-2215 W5)', () => {
    it('hands the dungeon to the content browser and auto-picks the Dungeon event type', () => {
        renderForm({ initialGame: GAME, initialInstances: [WC] });
        expect(screen.getByTestId('content-browser')).toHaveTextContent('Wailing Caverns');
        expect(screen.getByTestId('content-browser')).toHaveAttribute('data-type', 'dungeon');
        expect(screen.getByRole('combobox', { name: 'Event Type' })).toHaveValue('8');
    });

    it('ignores the plan dungeon in edit mode', () => {
        const event = { id: 1, title: 'Old', startTime: '2026-08-20T20:00:00.000Z', endTime: '2026-08-20T23:00:00.000Z', game: GAME, contentInstances: [] };
        renderForm({ event: event as unknown as EventResponseDto, initialInstances: [WC] });
        expect(screen.queryByText('Wailing Caverns')).not.toBeInTheDocument();
    });
});

describe('CreateEventForm — "Will invite" line (ROK-2215 W7)', () => {
    it('lists the resolved names above the footer, and "Don\'t invite" clears it', () => {
        renderForm({ initialGame: GAME, inviteCharacterIds: IDS, inviteNames: { names: ['Aelin', 'Brann'], unresolved: 0 } });
        expect(screen.getByTestId('invite-preview-line')).toHaveTextContent('Will invite: Aelin, Brann');
        expect(vi.mocked(useCreateEventMutation).mock.lastCall?.[0].inviteCharacterIds).toEqual(IDS);
        fireEvent.click(screen.getByRole('button', { name: "Don't invite" }));
        expect(screen.queryByTestId('invite-preview-line')).not.toBeInTheDocument();
        // The submit mutation must lose the ids too, not just the line.
        expect(vi.mocked(useCreateEventMutation).mock.lastCall?.[0].inviteCharacterIds).toEqual([]);
    });

    it('falls back to a count when no names resolved', () => {
        renderForm({ initialGame: GAME, inviteCharacterIds: IDS });
        expect(screen.getByTestId('invite-preview-line')).toHaveTextContent('Will invite 2 characters');
    });

    it('shows no line on a poll lock-in or without plan characters', () => {
        renderForm({ initialGame: GAME, inviteCharacterIds: IDS, schedulingMatchId: 3, initialStartTime: '2026-08-20T20:00:00.000Z' });
        expect(screen.queryByTestId('invite-preview-line')).not.toBeInTheDocument();
    });
});
