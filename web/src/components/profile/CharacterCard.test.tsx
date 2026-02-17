/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CharacterCard } from './CharacterCard';
import * as useCharacterMutationsHook from '../../hooks/use-character-mutations';
import type { CharacterDto } from '@raid-ledger/contract';

// Mock the plugins module so PluginSlot renders nothing
vi.mock('../../plugins', () => ({
    PluginSlot: () => null,
}));

const createMockCharacter = (overrides: Partial<CharacterDto> = {}): CharacterDto => ({
    id: 'char-uuid-1',
    userId: 1,
    gameId: 'game-uuid-wow',
    name: 'Arthas',
    realm: 'Frostmourne',
    class: 'Death Knight',
    spec: 'Unholy',
    role: 'dps',
    roleOverride: null,
    effectiveRole: 'dps',
    isMain: false,
    itemLevel: 450,
    externalId: null,
    avatarUrl: null,
    renderUrl: null,
    level: 80,
    race: 'Human',
    faction: 'alliance',
    lastSyncedAt: null,
    profileUrl: null,
    region: 'us',
    gameVariant: 'retail',
    equipment: null,
    displayOrder: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
});

const renderWithRouter = (ui: React.ReactElement) => {
    return render(<BrowserRouter>{ui}</BrowserRouter>);
};

describe('CharacterCard', () => {
    const mockDeleteMutate = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(useCharacterMutationsHook, 'useDeleteCharacter').mockReturnValue({
            mutate: mockDeleteMutate,
            isPending: false,
        } as any);
    });

    describe('Action button responsive stacking', () => {
        it('renders action container with flex-col on mobile and sm:flex-row on desktop', () => {
            const { container } = renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            const actionsDiv = container.querySelector('.flex.flex-col.sm\\:flex-row');
            expect(actionsDiv).toBeInTheDocument();
        });

        it('Edit button has min-h-[44px] touch target on mobile', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            const editBtn = screen.getByText('Edit');
            expect(editBtn).toHaveClass('min-h-[44px]');
        });

        it('Edit button removes min-h on desktop with sm:min-h-0', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            const editBtn = screen.getByText('Edit');
            expect(editBtn).toHaveClass('sm:min-h-0');
        });

        it('Delete button has min-h-[44px] touch target on mobile', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            const deleteBtn = screen.getByText('Delete');
            expect(deleteBtn).toHaveClass('min-h-[44px]');
        });

        it('Delete button removes min-h on desktop with sm:min-h-0', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            const deleteBtn = screen.getByText('Delete');
            expect(deleteBtn).toHaveClass('sm:min-h-0');
        });

        it('actions container uses items-stretch on mobile and sm:items-center on desktop', () => {
            const { container } = renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            const actionsDiv = container.querySelector('.items-stretch.sm\\:items-center');
            expect(actionsDiv).toBeInTheDocument();
        });
    });

    describe('Character display', () => {
        it('renders character name', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ name: 'Thrall' })} onEdit={vi.fn()} />
            );
            expect(screen.getByText('Thrall')).toBeInTheDocument();
        });

        it('links character name to detail page', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ id: 'char-abc', name: 'Jaina' })} onEdit={vi.fn()} />
            );
            const link = screen.getByRole('link');
            expect(link).toHaveAttribute('href', '/characters/char-abc');
        });

        it('renders faction badge for alliance character', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ faction: 'alliance' })} onEdit={vi.fn()} />
            );
            expect(screen.getByText('Alliance')).toBeInTheDocument();
        });

        it('renders faction badge for horde character', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ faction: 'horde' })} onEdit={vi.fn()} />
            );
            expect(screen.getByText('Horde')).toBeInTheDocument();
        });

        it('renders level when provided', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ level: 70 })} onEdit={vi.fn()} />
            );
            expect(screen.getByText('Lv.70')).toBeInTheDocument();
        });

        it('renders class and spec', () => {
            renderWithRouter(
                <CharacterCard
                    character={createMockCharacter({ class: 'Paladin', spec: 'Holy' })}
                    onEdit={vi.fn()}
                />
            );
            expect(screen.getByText('Paladin')).toBeInTheDocument();
            expect(screen.getByText(/Holy/)).toBeInTheDocument();
        });

        it('renders item level when provided', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ itemLevel: 500 })} onEdit={vi.fn()} />
            );
            expect(screen.getByText('500 iLvl')).toBeInTheDocument();
        });

        it('renders Main badge when character isMain is true', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ isMain: true })} onEdit={vi.fn()} />
            );
            expect(screen.getByText(/Main/)).toBeInTheDocument();
        });

        it('does not render Main badge when character isMain is false', () => {
            renderWithRouter(
                <CharacterCard character={createMockCharacter({ isMain: false })} onEdit={vi.fn()} />
            );
            expect(screen.queryByText(/Main/)).not.toBeInTheDocument();
        });

        it('renders avatar image when avatarUrl is provided', () => {
            renderWithRouter(
                <CharacterCard
                    character={createMockCharacter({ avatarUrl: 'https://example.com/avatar.jpg', name: 'Arthas' })}
                    onEdit={vi.fn()}
                />
            );
            const img = screen.getByRole('img', { name: 'Arthas' });
            expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
        });
    });

    describe('Actions', () => {
        it('calls onEdit with character when Edit button is clicked', () => {
            const onEdit = vi.fn();
            const character = createMockCharacter({ name: 'Sylvanas' });
            renderWithRouter(<CharacterCard character={character} onEdit={onEdit} />);
            fireEvent.click(screen.getByText('Edit'));
            expect(onEdit).toHaveBeenCalledWith(character);
        });

        it('calls deleteMutation.mutate when Delete is confirmed', () => {
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            const character = createMockCharacter({ id: 'char-delete-me', name: 'DeleteMe' });
            renderWithRouter(<CharacterCard character={character} onEdit={vi.fn()} />);
            fireEvent.click(screen.getByText('Delete'));
            expect(mockDeleteMutate).toHaveBeenCalledWith('char-delete-me');
        });

        it('does not call deleteMutation.mutate when Delete is cancelled', () => {
            vi.spyOn(window, 'confirm').mockReturnValue(false);
            const character = createMockCharacter({ name: 'KeepMe' });
            renderWithRouter(<CharacterCard character={character} onEdit={vi.fn()} />);
            fireEvent.click(screen.getByText('Delete'));
            expect(mockDeleteMutate).not.toHaveBeenCalled();
        });

        it('disables Delete button when deleteMutation is pending', () => {
            vi.spyOn(useCharacterMutationsHook, 'useDeleteCharacter').mockReturnValue({
                mutate: mockDeleteMutate,
                isPending: true,
            } as any);
            renderWithRouter(
                <CharacterCard character={createMockCharacter()} onEdit={vi.fn()} />
            );
            expect(screen.getByText('Delete')).toBeDisabled();
        });
    });
});
