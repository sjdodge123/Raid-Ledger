/**
 * ROK-1724 core hook #2: router state `{ addCharacter }` opens Add Character
 * prefilled (the name-mismatch deep link). Game-neutral: any registered game.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, within, fireEvent } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders } from '../../test/render-helpers';
import { readCharacterPrefill } from '../../plugins/character-identity';
import { CharactersPanel } from './characters-panel';

vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../hooks/use-auth')>(),
    useAuth: () => ({ isAuthenticated: true, user: { id: 1 } }),
}));
const charactersQuery = { data: { data: [] } as { data: unknown[] } | undefined, isLoading: false, error: null as Error | null, refetch: vi.fn() };
vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: () => charactersQuery,
}));
// One stable array, like the registry query's cached data.
const GAMES = [{ id: 7, name: 'Test Quest', slug: 'test-quest', hasRoles: true }];
vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: GAMES, isLoading: false }),
}));

const PATH = '/profile/gaming/characters';

function renderPanel(state: unknown) {
    return renderWithProviders(<CharactersPanel />, { initialEntries: [{ pathname: PATH, state }] });
}

describe('CharactersPanel router-state prefill', () => {
    it('opens Add Character prefilled from { addCharacter }', async () => {
        renderPanel({ addCharacter: { gameId: 7, name: 'Ana', class: 'Paladin' } });
        expect(await screen.findByRole('dialog', { name: /Add Character/ })).toBeInTheDocument();
        expect(screen.getByDisplayValue('Ana')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Paladin')).toBeInTheDocument();
    });

    it('stays closed without router state', () => {
        renderPanel(null);
        expect(screen.queryByRole('dialog', { name: /Add Character/ })).toBeNull();
    });
});

function LocationProbe() {
    const { search } = useLocation();
    return <output data-testid="search">{search}</output>;
}

function renderAt(search: string) {
    return renderWithProviders(<><CharactersPanel /><LocationProbe /></>, { initialEntries: [`${PATH}${search}`] });
}

describe('CharactersPanel ?game= deep link (ROK-2294)', () => {
    it('opens Add Character with the game preselected and strips the param', () => {
        renderAt('?game=7&tab=x');
        const dialog = screen.getByRole('dialog', { name: /Add Character/ });
        expect(within(dialog).getAllByText(/Test Quest/).length).toBeGreaterThan(0);
        expect(screen.getByTestId('search').textContent).toBe('?tab=x');
    });

    it.each([['?game=999'], ['?game=abc'], ['?game=']])('ignores an unknown/invalid id %s but still strips it', (search) => {
        renderAt(search);
        expect(screen.getByText('My Characters')).toBeInTheDocument();
        expect(screen.queryByRole('dialog', { name: /Add Character/ })).toBeNull();
        expect(screen.getByTestId('search').textContent).toBe('');
    });
});

describe('readCharacterPrefill', () => {
    it.each([
        [null],
        [{}],
        [{ addCharacter: { name: 'Ana' } }],
        [{ addCharacter: { gameId: '7', name: 'Ana' } }],
        [{ addCharacter: { gameId: 7, name: 'Ana', region: 3 } }],
    ])('rejects malformed state %j', (state) => {
        expect(readCharacterPrefill(state)).toBeNull();
    });

    it('accepts a well-formed prefill', () => {
        const addCharacter = { gameId: 7, name: 'Ana', region: 'us', ruleset: null };
        expect(readCharacterPrefill({ addCharacter })).toBe(addCharacter);
    });
});

describe('CharactersPanel — ROK-2342: a failed characters query is an error, not "No characters yet"', () => {
    afterEach(() => {
        charactersQuery.data = { data: [] };
        charactersQuery.error = null;
    });

    it('shows the retryable error state and Try again refetches', () => {
        charactersQuery.data = undefined;
        charactersQuery.error = new Error('HTTP 500');
        charactersQuery.refetch = vi.fn();
        renderPanel(null);
        expect(screen.getByRole('heading', { name: "Couldn't load your characters" })).toBeInTheDocument();
        expect(screen.queryByText('No characters yet')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(charactersQuery.refetch).toHaveBeenCalledTimes(1);
    });
});
