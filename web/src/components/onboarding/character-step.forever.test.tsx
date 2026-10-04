/**
 * Onboarding CharacterStep — WoW: Forever (ROK-1721): the Forever game (by
 * slug) gets the Forever identity fields and creates with region + ruleset +
 * the full two-part name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GameRegistryDto } from '@raid-ledger/contract';
import { CharacterStep } from './character-step';
import { useCreateCharacter } from '../../hooks/use-character-mutations';

vi.mock('../../hooks/use-character-mutations', () => ({
    useCreateCharacter: vi.fn(), useDeleteCharacter: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../hooks/use-characters', () => ({ useMyCharacters: vi.fn(() => ({ data: { data: [] } })) }));
vi.mock('../../plugins', () => ({ PluginSlot: () => null }));

const mutate = vi.fn();
beforeEach(() => {
    mutate.mockReset();
    vi.mocked(useCreateCharacter).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useCreateCharacter>);
});

const game = (slug: string): GameRegistryDto => ({
    id: 7, name: 'World of Warcraft: Forever', shortName: null, slug, hasRoles: true, hasSpecs: true,
    coverUrl: null, colorHex: '#F58518', maxCharactersPerUser: 10, enabled: true, genres: [],
} as GameRegistryDto);
const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const create = () => fireEvent.click(screen.getByRole('button', { name: /create character/i }));

describe('CharacterStep — WoW: Forever', () => {
    it('renders the Forever fields instead of Name and Realm/Server only for the Forever game', () => {
        const { unmount } = render(<CharacterStep preselectedGame={game('world-of-warcraft-forever')} charIndex={0} />);
        expect(screen.getByRole('radiogroup', { name: 'Ruleset' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Realm/Server' })).not.toBeInTheDocument();
        unmount();
        render(<CharacterStep preselectedGame={game('world-of-warcraft')} charIndex={0} />);
        expect(screen.getByRole('textbox', { name: 'Realm/Server' })).toBeInTheDocument();
        expect(screen.queryByTestId('forever-identity-fields')).not.toBeInTheDocument();
    });

    it('shows the inline name errors and does not create', () => {
        render(<CharacterStep preselectedGame={game('world-of-warcraft-forever')} charIndex={0} />);
        type('Second name', 'Forever');
        create();
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a first and second name');
        type('First name', 'Ana-Lee');
        create();
        expect(screen.getByText('Letters only, 2–24')).toBeInTheDocument();
        expect(mutate).not.toHaveBeenCalled();
    });

    it('creates with region + ruleset + "First Second" and no realm', () => {
        render(<CharacterStep preselectedGame={game('world-of-warcraft-forever')} charIndex={0} />);
        fireEvent.click(screen.getByRole('radio', { name: 'PvP' }));
        type('First name', 'Ana'); type('Second name', 'Forever');
        create();
        const dto = mutate.mock.calls[0]?.[0];
        expect(dto).toMatchObject({ gameId: 7, name: 'Ana Forever', region: 'us', ruleset: 'pvp' });
        expect(dto.realm).toBeUndefined();
    });
});
