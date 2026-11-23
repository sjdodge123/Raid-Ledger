/**
 * ROK-2294: the signup character step's in-place import entry. With at least
 * one character the "Don't see your character? Import it" control opens the
 * inline create/import form; with none the empty state keeps "Create Character First".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type { CharacterDto } from '@raid-ledger/contract';
import { renderWithProviders } from '../../test/render-helpers';
import { useMyCharacters } from '../../hooks/use-characters';
import { SignupConfirmationModal } from './signup-confirmation-modal';

vi.mock('../../hooks/use-characters', () => ({ useMyCharacters: vi.fn() }));
// No plugins active: the WoW import slot renders nothing.
vi.mock('../../plugins', () => ({ PluginSlot: () => null }));

const IMPORT_COPY = "Don't see your character? Import it";

function character(overrides: Partial<CharacterDto> = {}): CharacterDto {
    return {
        id: '00000000-0000-4000-8000-000000000001', userId: 1, gameId: 3, name: 'Ana',
        realm: null, class: null, spec: null, role: null, roleOverride: null, effectiveRole: null,
        isMain: true, itemLevel: null, externalId: null, avatarUrl: null, renderUrl: null, level: null,
        race: null, faction: null, lastSyncedAt: null, profileUrl: null, region: null, ruleset: null,
        gameVariant: null, equipment: null, talents: null, professions: null, displayOrder: 0,
        createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
        ...overrides,
    } as CharacterDto;
}

function mockCharacters(chars: CharacterDto[]): void {
    vi.mocked(useMyCharacters).mockReturnValue(
        { data: { data: chars }, isLoading: false, isError: false, error: null } as unknown as ReturnType<typeof useMyCharacters>,
    );
}

function renderModal(): void {
    renderWithProviders(
        <SignupConfirmationModal isOpen onClose={vi.fn()} onConfirm={vi.fn()} onSkip={vi.fn()}
            gameId={3} gameName="Test Quest" hasRoles={false} />,
    );
}

beforeEach(() => vi.mocked(useMyCharacters).mockReset());

describe('SignupConfirmationModal — import entry', () => {
    it('shows the import copy (and no old "Add another" copy) when the user has a character', () => {
        mockCharacters([character()]);
        renderModal();
        expect(screen.getByRole('button', { name: IMPORT_COPY })).toBeInTheDocument();
        expect(screen.queryByText(/Add another character/)).toBeNull();
    });

    it('clicking the import control opens the inline create/import form in place', () => {
        mockCharacters([character()]);
        renderModal();
        expect(screen.queryByRole('textbox', { name: 'Character name' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: IMPORT_COPY }));
        expect(screen.getByText('Add Character')).toBeInTheDocument();
        expect(screen.getByRole('textbox', { name: 'Character name' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: IMPORT_COPY })).toBeNull();
    });

    it('with zero characters shows "Create Character First", not the import copy', () => {
        mockCharacters([]);
        renderModal();
        expect(screen.getByRole('button', { name: 'Create Character First' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: IMPORT_COPY })).toBeNull();
    });
});
