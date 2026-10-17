/**
 * ROK-1724 core hook #2: router state `{ addCharacter }` opens Add Character
 * prefilled (the name-mismatch deep link). Game-neutral: any registered game.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/render-helpers';
import { readCharacterPrefill } from '../../plugins/character-identity';
import { CharactersPanel } from './characters-panel';

vi.mock('../../hooks/use-auth', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../hooks/use-auth')>(),
    useAuth: () => ({ isAuthenticated: true, user: { id: 1 } }),
}));
vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: () => ({ data: { data: [] }, isLoading: false }),
}));
vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: () => ({ games: [{ id: 7, name: 'Test Quest', slug: 'test-quest', hasRoles: true }], isLoading: false }),
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
