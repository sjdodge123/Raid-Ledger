/**
 * AddCharacterModal — WoW: Forever manual entry (ROK-1721). Forever (by game
 * slug) swaps Name + Realm for Region / Ruleset / First + Second name, submits
 * region + ruleset + the full "First Second" name, and locks region on edit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CharacterDto } from '@raid-ledger/contract';
import { AddCharacterModal } from './AddCharacterModal';
import { useCreateCharacter, useUpdateCharacter } from '../../hooks/use-character-mutations';

vi.mock('../../hooks/use-character-mutations', () => ({
    useCreateCharacter: vi.fn(), useUpdateCharacter: vi.fn(),
    useSetMainCharacter: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock('../../hooks/use-characters', () => ({ useMyCharacters: vi.fn(() => ({ data: { data: [] }, isLoading: false })) }));
vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({
        games: [
            { id: 1, name: 'World of Warcraft', slug: 'world-of-warcraft', hasRoles: true },
            { id: 7, name: 'World of Warcraft: Forever', slug: 'world-of-warcraft-forever', hasRoles: true },
        ],
        isLoading: false,
    })),
}));
vi.mock('../events/game-search-input', () => ({ GameSearchInput: () => null }));
vi.mock('../../plugins', () => ({ PluginSlot: () => null }));

const createMutate = vi.fn();
const updateMutate = vi.fn();

beforeEach(() => {
    createMutate.mockReset(); updateMutate.mockReset();
    vi.mocked(useCreateCharacter).mockReturnValue({ mutate: createMutate, isPending: false } as unknown as ReturnType<typeof useCreateCharacter>);
    vi.mocked(useUpdateCharacter).mockReturnValue({ mutate: updateMutate, isPending: false } as unknown as ReturnType<typeof useUpdateCharacter>);
});

function renderModal(gameId: number, editingCharacter: CharacterDto | null = null) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={qc}>
            <AddCharacterModal isOpen onClose={vi.fn()} gameId={gameId} editingCharacter={editingCharacter} />
        </QueryClientProvider>,
    );
}

const type = (name: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const submit = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

const foreverChar = {
    id: 'c-1', userId: 1, gameId: 7, name: 'Ana Forever', realm: null, class: 'Paladin', spec: null, role: 'healer',
    roleOverride: null, effectiveRole: 'healer', isMain: true, itemLevel: null, externalId: null, avatarUrl: null,
    renderUrl: null, level: null, race: null, faction: null, lastSyncedAt: null, profileUrl: null, region: 'eu',
    ruleset: 'pvp', gameVariant: null, equipment: null, talents: null, professions: null, displayOrder: 1,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
} as CharacterDto;

describe('AddCharacterModal — WoW: Forever fields', () => {
    it('renders Region / Ruleset / First + Second name instead of Name and Realm, Hardcore hidden, US default', () => {
        renderModal(7);
        expect(screen.getByRole('combobox', { name: 'Region' })).toHaveValue('us');
        expect(screen.getByRole('radiogroup', { name: 'Ruleset' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Normal' })).toBeChecked();
        expect(screen.queryByRole('radio', { name: 'Hardcore' })).not.toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'First name' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Second name' })).toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
        expect(screen.queryByRole('textbox', { name: 'Realm/Server' })).not.toBeInTheDocument();
    });

    it('keeps the plain Name + Realm fields for any other game', () => {
        renderModal(1);
        expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Realm/Server' })).toBeInTheDocument();
        expect(screen.queryByTestId('forever-identity-fields')).not.toBeInTheDocument();
    });

    it('blocks submit with "Enter a first and second name" and "Letters only, 2–24"', () => {
        renderModal(7);
        type('First name', 'Ana');
        submit(/add character/i);
        expect(screen.getByRole('alert')).toHaveTextContent('Enter a first and second name');
        type('Second name', 'F0rever');
        submit(/add character/i);
        expect(screen.getByText('Letters only, 2–24')).toBeInTheDocument();
        expect(createMutate).not.toHaveBeenCalled();
    });

    it('creates with region + ruleset + the full two-part name and no realm', () => {
        renderModal(7);
        fireEvent.change(screen.getByRole('combobox', { name: 'Region' }), { target: { value: 'eu' } });
        fireEvent.click(screen.getByRole('radio', { name: 'PvP' }));
        type('First name', ' Ana '); type('Second name', 'Forever');
        expect(screen.getByText(/Shown in-game as “Ana Forever”/)).toBeInTheDocument();
        submit(/add character/i);
        const dto = createMutate.mock.calls[0]?.[0];
        expect(dto).toMatchObject({ gameId: 7, name: 'Ana Forever', region: 'eu', ruleset: 'pvp' });
        expect(dto.realm).toBeUndefined();
    });

    it('shows the server 409 as a form alert', () => {
        createMutate.mockImplementation((_dto, opts: { onError: (e: Error) => void }) =>
            opts.onError(new Error('Ana Forever (US) is already claimed by another player')));
        renderModal(7);
        type('First name', 'Ana'); type('Second name', 'Forever');
        submit(/add character/i);
        expect(screen.getByRole('alert')).toHaveTextContent('Ana Forever (US) is already claimed by another player');
    });

    it('edit mode: region is read-only and the update never sends a region', () => {
        renderModal(7, foreverChar);
        const region = screen.getByRole('combobox', { name: 'Region' });
        expect(region).toHaveValue('eu');
        expect(region).toBeDisabled();
        expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Ana');
        expect(screen.getByRole('textbox', { name: 'Second name' })).toHaveValue('Forever');
        fireEvent.click(screen.getByRole('radio', { name: 'Roleplaying' }));
        submit(/save changes/i);
        const { dto } = updateMutate.mock.calls[0]?.[0] as { dto: Record<string, unknown> };
        expect(dto).toMatchObject({ name: 'Ana Forever', ruleset: 'roleplaying' });
        expect(dto).not.toHaveProperty('region');
        expect(dto.realm).toBeUndefined();
    });
});
