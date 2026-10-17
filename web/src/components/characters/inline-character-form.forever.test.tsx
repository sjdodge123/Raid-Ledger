/**
 * InlineCharacterForm — WoW: Forever (ROK-1721): the signup-modal inline form
 * swaps Character name + Realm for the Forever identity fields when the game
 * slug is WoW: Forever, and creates with region + ruleset + full name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineCharacterForm } from './inline-character-form';
import { useCreateCharacter } from '../../hooks/use-character-mutations';
import { activateWowPlugin } from '../../test/activate-wow-plugin';

vi.mock('../../hooks/use-character-mutations', () => ({ useCreateCharacter: vi.fn() }));
vi.mock('../../plugins', () => ({ PluginSlot: () => null }));

const mutate = vi.fn();
beforeEach(() => {
    activateWowPlugin();
    mutate.mockReset();
    vi.mocked(useCreateCharacter).mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<typeof useCreateCharacter>);
});

const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const create = () => fireEvent.click(screen.getByRole('button', { name: /create character/i }));

describe('InlineCharacterForm — WoW: Forever', () => {
    it('renders the Forever fields (no Character name, no Realm) only for the Forever slug', () => {
        const { unmount } = render(<InlineCharacterForm gameId={7} gameSlug="world-of-warcraft-forever" />);
        expect(screen.getByRole('textbox', { name: 'First name' })).toBeInTheDocument();
        expect(screen.getByRole('combobox', { name: 'Region' })).toHaveValue('us');
        expect(screen.queryByRole('textbox', { name: 'Character name' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Realm' })).not.toBeInTheDocument();
        unmount();
        render(<InlineCharacterForm gameId={1} gameSlug="world-of-warcraft" />);
        expect(screen.getByRole('textbox', { name: 'Character name' })).toBeInTheDocument();
        expect(screen.queryByTestId('forever-identity-fields')).not.toBeInTheDocument();
    });

    it('validates both name parts before creating', () => {
        render(<InlineCharacterForm gameId={7} gameSlug="world-of-warcraft-forever" />);
        create();
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a first and second name');
        type('First name', 'A'); type('Second name', 'Forever');
        create();
        expect(screen.getByText('Letters only, 2–24')).toBeInTheDocument();
        expect(mutate).not.toHaveBeenCalled();
    });

    it('creates with region + ruleset + "First Second" and no realm', () => {
        render(<InlineCharacterForm gameId={7} gameSlug="world-of-warcraft-forever" />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Region' }), { target: { value: 'kr' } });
        fireEvent.click(screen.getByRole('radio', { name: 'Roleplaying' }));
        type('First name', 'Ana'); type('Second name', 'Forever');
        create();
        const dto = mutate.mock.calls[0]?.[0];
        expect(dto).toMatchObject({ gameId: 7, name: 'Ana Forever', region: 'kr', ruleset: 'roleplaying', isMain: true });
        expect(dto.realm).toBeUndefined();
    });
});
