import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CharacterStep } from './character-step';
import type { GameRegistryDto } from '@raid-ledger/contract';

vi.mock('../../hooks/use-character-mutations', () => ({
    useCreateCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
    useDeleteCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
}));

vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: vi.fn(() => ({
        data: { data: [] },
    })),
}));

vi.mock('../../plugins', () => ({
    PluginSlot: () => null,
}));

import { useCreateCharacter, useDeleteCharacter } from '../../hooks/use-character-mutations';
import { useMyCharacters } from '../../hooks/use-characters';

const mockUseCreateCharacter = useCreateCharacter as unknown as ReturnType<typeof vi.fn>;
const mockUseDeleteCharacter = useDeleteCharacter as unknown as ReturnType<typeof vi.fn>;
const mockUseMyCharacters = useMyCharacters as unknown as ReturnType<typeof vi.fn>;

const baseGame: GameRegistryDto = {
    id: 1,
    name: 'World of Warcraft',
    shortName: 'WoW',
    slug: 'wow',
    hasRoles: true,
    hasSpecs: true,
    coverUrl: null,
    colorHex: '#F58518',
    maxCharactersPerUser: 10,
    enabled: true,
};

const nonMmoGame: GameRegistryDto = {
    id: 2,
    name: 'Factorio',
    shortName: null,
    slug: 'factorio',
    hasRoles: false,
    hasSpecs: false,
    coverUrl: null,
    colorHex: '#6B7280',
    maxCharactersPerUser: 5,
    enabled: true,
};

function createQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithProviders(ui: React.ReactElement) {
    return render(
        <QueryClientProvider client={createQueryClient()}>
            {ui}
        </QueryClientProvider>
    );
}

describe('CharacterStep', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockUseCreateCharacter.mockReturnValue({ mutate: vi.fn(), isPending: false });
        mockUseDeleteCharacter.mockReturnValue({ mutate: vi.fn(), isPending: false });
        mockUseMyCharacters.mockReturnValue({ data: { data: [] } });
    });

    describe('Rendering', () => {
        it('renders the character creation form when no character exists', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByText(/create a character/i)).toBeInTheDocument();
            expect(screen.getByText(/world of warcraft/i)).toBeInTheDocument();
        });

        it('renders the character name input', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByPlaceholderText(/character name/i)).toBeInTheDocument();
        });

        it('character name input meets minimum 44px touch target height (min-h-[44px])', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const nameInput = container.querySelector('input[placeholder="Character name"]');
            expect(nameInput).not.toBeNull();
            expect(nameInput!.className).toContain('min-h-[44px]');
        });

        it('shows Class and Spec fields for MMO games with roles', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByPlaceholderText(/warrior/i)).toBeInTheDocument();
            expect(screen.getByPlaceholderText(/arms/i)).toBeInTheDocument();
        });

        it('does not show Class and Spec fields for non-MMO games', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={nonMmoGame} charIndex={0} />
            );
            expect(screen.queryByPlaceholderText(/warrior/i)).not.toBeInTheDocument();
            expect(screen.queryByPlaceholderText(/arms/i)).not.toBeInTheDocument();
        });

        it('shows Role dropdown for MMO games', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        it('shows Realm input for MMO games', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByPlaceholderText(/illidan/i)).toBeInTheDocument();
        });
    });

    describe('Responsive grid (Class/Spec)', () => {
        it('Class/Spec grid uses single column on mobile (grid-cols-1) and two columns on sm (sm:grid-cols-2)', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            // The grid container for class/spec should have both classes
            const gridDiv = container.querySelector('.grid.grid-cols-1.sm\\:grid-cols-2');
            expect(gridDiv).not.toBeNull();
        });
    });

    describe('Input minimum heights (44px touch targets)', () => {
        it('Class input has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const classInput = container.querySelector('input[placeholder="e.g. Warrior"]');
            expect(classInput!.className).toContain('min-h-[44px]');
        });

        it('Spec input has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const specInput = container.querySelector('input[placeholder="e.g. Arms"]');
            expect(specInput!.className).toContain('min-h-[44px]');
        });

        it('Role select has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const roleSelect = container.querySelector('select');
            expect(roleSelect!.className).toContain('min-h-[44px]');
        });

        it('Realm input has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const realmInput = container.querySelector('input[placeholder="e.g. Illidan"]');
            expect(realmInput!.className).toContain('min-h-[44px]');
        });

        it('Submit button has min-h-[44px]', () => {
            const { container } = renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const submitButton = container.querySelector('button[type="submit"]');
            expect(submitButton!.className).toContain('min-h-[44px]');
        });
    });

    describe('Form interaction', () => {
        it('shows validation error when submitting without a name', async () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            const submitButton = screen.getByRole('button', { name: /create character/i });
            fireEvent.click(submitButton);
            await waitFor(() => {
                expect(screen.getByText(/character name is required/i)).toBeInTheDocument();
            });
        });

        it('calls createMutation.mutate when form is submitted with valid name', async () => {
            const mockMutate = vi.fn();
            mockUseCreateCharacter.mockReturnValue({ mutate: mockMutate, isPending: false });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );

            const nameInput = screen.getByPlaceholderText(/character name/i);
            fireEvent.change(nameInput, { target: { value: 'Arthas' } });

            const submitButton = screen.getByRole('button', { name: /create character/i });
            fireEvent.click(submitButton);

            expect(mockMutate).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'Arthas', gameId: 1 }),
                expect.any(Object),
            );
        });

        it('shows pending state on submit button while creating', () => {
            mockUseCreateCharacter.mockReturnValue({ mutate: vi.fn(), isPending: true });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByText(/creating/i)).toBeInTheDocument();
        });

        it('role dropdown has tank, healer, dps options', () => {
            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );
            expect(screen.getByRole('option', { name: /tank/i })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: /healer/i })).toBeInTheDocument();
            expect(screen.getByRole('option', { name: /dps/i })).toBeInTheDocument();
        });
    });

    describe('Saved character display', () => {
        it('shows saved character card when character exists at charIndex', () => {
            mockUseMyCharacters.mockReturnValue({
                data: {
                    data: [
                        {
                            id: 'char-1',
                            name: 'Thrall',
                            class: 'Shaman',
                            spec: 'Enhancement',
                            effectiveRole: 'dps',
                            isMain: true,
                            avatarUrl: null,
                            level: 80,
                            race: 'Orc',
                            realm: 'Draenor',
                            gameId: 'wow',
                        },
                    ],
                },
            });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );

            expect(screen.getByText('Thrall')).toBeInTheDocument();
        });

        it('shows Add Another Character button when character is saved', () => {
            mockUseMyCharacters.mockReturnValue({
                data: {
                    data: [
                        {
                            id: 'char-1',
                            name: 'Thrall',
                            class: 'Shaman',
                            spec: 'Enhancement',
                            effectiveRole: 'dps',
                            isMain: true,
                            avatarUrl: null,
                            level: 80,
                            race: 'Orc',
                            realm: 'Draenor',
                            gameId: 'wow',
                        },
                    ],
                },
            });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} onAddAnother={vi.fn()} />
            );

            const addButton = screen.getByRole('button', { name: /add another character/i });
            expect(addButton).toBeInTheDocument();
            expect(addButton.className).toContain('min-h-[44px]');
        });

        it('calls onAddAnother when Add Another Character is clicked', () => {
            const mockOnAddAnother = vi.fn();
            mockUseMyCharacters.mockReturnValue({
                data: {
                    data: [
                        {
                            id: 'char-1',
                            name: 'Thrall',
                            class: 'Shaman',
                            spec: null,
                            effectiveRole: null,
                            isMain: true,
                            avatarUrl: null,
                            level: null,
                            race: null,
                            realm: null,
                            gameId: 'wow',
                        },
                    ],
                },
            });

            renderWithProviders(
                <CharacterStep
                    preselectedGame={baseGame}
                    charIndex={0}
                    onAddAnother={mockOnAddAnother}
                />
            );

            fireEvent.click(screen.getByRole('button', { name: /add another character/i }));
            expect(mockOnAddAnother).toHaveBeenCalledOnce();
        });

        it('calls onRemoveStep when delete button is clicked on extra step (charIndex > 0)', async () => {
            const mockOnRemoveStep = vi.fn();
            const mockDeleteMutate = vi.fn((_id, options) => {
                options?.onSuccess?.();
            });
            mockUseDeleteCharacter.mockReturnValue({ mutate: mockDeleteMutate, isPending: false });
            mockUseMyCharacters.mockReturnValue({
                data: {
                    data: [
                        { id: 'char-0', name: 'Char0', class: null, spec: null, effectiveRole: null, isMain: true, avatarUrl: null, level: null, race: null, realm: null, gameId: 'wow' },
                        { id: 'char-1', name: 'Char1', class: null, spec: null, effectiveRole: null, isMain: false, avatarUrl: null, level: null, race: null, realm: null, gameId: 'wow' },
                    ],
                },
            });

            renderWithProviders(
                <CharacterStep
                    preselectedGame={baseGame}
                    charIndex={1}
                    onRemoveStep={mockOnRemoveStep}
                />
            );

            // The delete button is the X icon button
            const deleteButton = screen.getByTitle(/remove character/i);
            fireEvent.click(deleteButton);

            await waitFor(() => {
                expect(mockOnRemoveStep).toHaveBeenCalledOnce();
            });
        });
    });

    describe('Edge cases', () => {
        it('renders with empty character list (no data)', () => {
            mockUseMyCharacters.mockReturnValue({ data: undefined });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );

            expect(screen.getByText(/create a character/i)).toBeInTheDocument();
        });

        it('first character becomes main (isMain: true)', () => {
            const mockMutate = vi.fn();
            mockUseCreateCharacter.mockReturnValue({ mutate: mockMutate, isPending: false });
            mockUseMyCharacters.mockReturnValue({ data: { data: [] } });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );

            const nameInput = screen.getByPlaceholderText(/character name/i);
            fireEvent.change(nameInput, { target: { value: 'FirstChar' } });

            const submitButton = screen.getByRole('button', { name: /create character/i });
            fireEvent.click(submitButton);

            expect(mockMutate).toHaveBeenCalledWith(
                expect.objectContaining({ isMain: true }),
                expect.any(Object),
            );
        });

        it('shows general error message on creation failure', async () => {
            const mockMutate = vi.fn((_data, options) => {
                options?.onError?.();
            });
            mockUseCreateCharacter.mockReturnValue({ mutate: mockMutate, isPending: false });

            renderWithProviders(
                <CharacterStep preselectedGame={baseGame} charIndex={0} />
            );

            const nameInput = screen.getByPlaceholderText(/character name/i);
            fireEvent.change(nameInput, { target: { value: 'Arthas' } });

            const submitButton = screen.getByRole('button', { name: /create character/i });
            fireEvent.click(submitButton);

            await waitFor(() => {
                expect(screen.getByText(/failed to create character/i)).toBeInTheDocument();
            });
        });
    });
});
