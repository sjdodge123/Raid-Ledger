/**
 * ROK-2215 W5 (page half), W6, W7 — `/events/new?contentInstanceIds=&inviteCharacterIds=`
 * (a dungeon-plan link): the page waits for the dungeon list, hands the form the
 * resolved dungeon and the roster names, and does nothing with the Blizzard plugin off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../test/render-helpers';
import { usePluginStore } from '../stores/plugin-store';
import { CreateEventPage } from './create-event-page';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const DUNGEON = { id: 90000004, name: 'Wailing Caverns', shortName: 'WC', expansion: 'Classic', minimumLevel: 15, maximumLevel: 25 };
const stub = vi.hoisted(() => ({ instancesLoading: false }));

vi.mock('../hooks/use-auth', () => ({ useAuth: () => ({ isAuthenticated: true, isLoading: false }) }));
vi.mock('../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [{ id: 3, name: 'WoW Forever', slug: 'world-of-warcraft-forever' }], isLoading: false }),
}));
vi.mock('../hooks/use-events', () => ({ useEvent: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock('../plugins/wow/hooks/use-wow-instances', () => ({
    useWowInstances: (variant?: string, type?: string) => (variant && type === 'dungeon'
        ? { data: stub.instancesLoading ? undefined : { data: [DUNGEON] }, isLoading: stub.instancesLoading }
        : { data: undefined, isLoading: false }),
}));
vi.mock('../plugins/wow/hub-widgets/use-roster-insights', () => ({
    useRosterInsights: (guildId: number) => ({
        data: guildId === 7 ? { classes: [{ members: [{ characterId: B, name: 'Brann' }, { characterId: A, name: 'Aelin' }] }] } : undefined,
    }),
}));
vi.mock('../components/events/create-event-form', () => ({
    CreateEventForm: (p: { initialInstances?: Array<{ name: string; category: string }>; inviteCharacterIds?: string[]; inviteNames?: { names: string[]; unresolved: number } }) => (
        <div data-testid="form" data-instances={(p.initialInstances ?? []).map((i) => `${i.name}:${i.category}`).join(',')}
            data-invites={(p.inviteCharacterIds ?? []).length} data-names={(p.inviteNames?.names ?? []).join(',')} data-unresolved={p.inviteNames?.unresolved ?? -1} />
    ),
}));

const PLAN = `/events/new?gameId=3&guildId=7&contentInstanceIds=90000004&inviteCharacterIds=${A},${B},${C}`;

beforeEach(() => {
    stub.instancesLoading = false;
    usePluginStore.setState({ activeSlugs: new Set(['core', 'blizzard']), initialized: true });
});

describe('CreateEventPage — dungeon-plan link (ROK-2215)', () => {
    it('W5: waits for the dungeon list before mounting the form', () => {
        stub.instancesLoading = true;
        renderWithProviders(<CreateEventPage />, { initialEntries: [PLAN] });
        expect(screen.queryByTestId('form'), 'the form seeds once, so it must not mount before the list').not.toBeInTheDocument();
    });

    it('W5: hands the form the resolved dungeon as a dungeon selection', () => {
        renderWithProviders(<CreateEventPage />, { initialEntries: [PLAN] });
        expect(screen.getByTestId('form')).toHaveAttribute('data-instances', 'Wailing Caverns:dungeon');
    });

    it('W7: resolves invite names from the hub roster in plan order; the rest count as unresolved', () => {
        renderWithProviders(<CreateEventPage />, { initialEntries: [PLAN] });
        const form = screen.getByTestId('form');
        expect(form).toHaveAttribute('data-invites', '3');
        expect(form).toHaveAttribute('data-names', 'Aelin,Brann');
        expect(form).toHaveAttribute('data-unresolved', '1');
    });

    it('W6: with the Blizzard plugin off, the plan params do nothing', () => {
        usePluginStore.setState({ activeSlugs: new Set(['core']), initialized: true });
        renderWithProviders(<CreateEventPage />, { initialEntries: [PLAN] });
        const form = screen.getByTestId('form');
        expect(form, 'no dungeon pre-fill').toHaveAttribute('data-instances', '');
        expect(form, 'no invites').toHaveAttribute('data-invites', '0');
    });

    it('W6: with the Blizzard plugin off, the page never waits for a dungeon list', () => {
        usePluginStore.setState({ activeSlugs: new Set(['core']), initialized: true });
        stub.instancesLoading = true;
        renderWithProviders(<CreateEventPage />, { initialEntries: [PLAN] });
        expect(screen.getByTestId('form')).toBeInTheDocument();
    });
});
