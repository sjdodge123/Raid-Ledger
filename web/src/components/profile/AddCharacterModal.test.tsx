import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddCharacterModal } from './AddCharacterModal';
import type { CharacterDto } from '@raid-ledger/contract';

// Mock hooks used by AddCharacterModal
vi.mock('../../hooks/use-character-mutations', () => ({
    useCreateCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
    useUpdateCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
    useSetMainCharacter: vi.fn(() => ({
        mutate: vi.fn(),
        isPending: false,
    })),
}));

vi.mock('../../hooks/use-characters', () => ({
    useMyCharacters: vi.fn(() => ({
        data: { data: [] },
        isLoading: false,
    })),
}));

vi.mock('../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(() => ({
        games: [
            {
                id: 'game-uuid-wow',
                name: 'World of Warcraft',
                slug: 'wow',
                hasRoles: true,
            },
        ],
        isLoading: false,
    })),
}));

// Mock GameSearchInput to avoid IGDB search complexity
vi.mock('../events/game-search-input', () => ({
    GameSearchInput: vi.fn(({ error }: { error?: string }) => (
        <div data-testid="game-search-input">
            {error && <span data-testid="game-search-error">{error}</span>}
        </div>
    )),
}));

// Mock PluginSlot to render nothing (no plugins active in tests)
vi.mock('../../plugins', () => ({
    PluginSlot: vi.fn(() => null),
}));

const createArmorySyncedCharacter = (overrides: Partial<CharacterDto> = {}): CharacterDto => ({
    id: 'char-uuid-1',
    userId: 1,
    gameId: 'game-uuid-wow',
    name: 'Thrall',
    realm: 'Illidan',
    class: 'Shaman',
    spec: 'Elemental',
    role: 'dps',
    roleOverride: null,
    effectiveRole: 'dps',
    isMain: false,
    itemLevel: 480,
    externalId: 'thrall-illidan',
    avatarUrl: null,
    renderUrl: null,
    level: 70,
    race: 'Orc',
    faction: 'horde',
    lastSyncedAt: '2026-02-01T00:00:00.000Z',
    profileUrl: null,
    region: 'us',
    gameVariant: 'retail',
    equipment: null,
    displayOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
});

const createManualCharacter = (overrides: Partial<CharacterDto> = {}): CharacterDto => ({
    id: 'char-uuid-2',
    userId: 1,
    gameId: 'game-uuid-wow',
    name: 'Jaina',
    realm: 'Stormwind',
    class: 'Mage',
    spec: 'Frost',
    role: 'dps',
    roleOverride: null,
    effectiveRole: 'dps',
    isMain: false,
    itemLevel: null,
    externalId: null,
    avatarUrl: null,
    renderUrl: null,
    level: null,
    race: null,
    faction: null,
    lastSyncedAt: null,
    profileUrl: null,
    region: null,
    gameVariant: null,
    equipment: null,
    displayOrder: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
});

function createQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false },
        },
    });
}

function renderModal(props: Partial<Parameters<typeof AddCharacterModal>[0]> = {}) {
    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        gameId: 'game-uuid-wow',
        gameName: 'World of Warcraft',
    };

    return render(
        <QueryClientProvider client={createQueryClient()}>
            <AddCharacterModal {...defaultProps} {...props} />
        </QueryClientProvider>
    );
}

describe('AddCharacterModal — armory-synced character', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the edit character modal title', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        expect(screen.getByText('Edit Character')).toBeInTheDocument();
    });

    it('displays the armory sync info banner for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        expect(
            screen.getByText(/This character is synced from the Blizzard Armory\. Some fields are read-only\./i)
        ).toBeInTheDocument();
    });

    it('disables the Name field for armory-synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).toBeDisabled();
    });

    it('applies opacity and cursor-not-allowed styling to Name field for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).toHaveClass('opacity-60');
        expect(nameInput).toHaveClass('cursor-not-allowed');
    });

    it('sets tooltip on Name field explaining sync', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).toHaveAttribute('title', 'This field is synced from the Blizzard Armory');
    });

    it('disables the Class field for armory-synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const classInput = screen.getByPlaceholderText('e.g. Warrior');
        expect(classInput).toBeDisabled();
    });

    it('applies opacity and cursor-not-allowed styling to Class field for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const classInput = screen.getByPlaceholderText('e.g. Warrior');
        expect(classInput).toHaveClass('opacity-60');
        expect(classInput).toHaveClass('cursor-not-allowed');
    });

    it('sets tooltip on Class field explaining sync', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const classInput = screen.getByPlaceholderText('e.g. Warrior');
        expect(classInput).toHaveAttribute('title', 'This field is synced from the Blizzard Armory');
    });

    it('disables the Spec field for armory-synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const specInput = screen.getByPlaceholderText('e.g. Arms');
        expect(specInput).toBeDisabled();
    });

    it('applies opacity and cursor-not-allowed styling to Spec field for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const specInput = screen.getByPlaceholderText('e.g. Arms');
        expect(specInput).toHaveClass('opacity-60');
        expect(specInput).toHaveClass('cursor-not-allowed');
    });

    it('disables the Realm field for armory-synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const realmInput = screen.getByPlaceholderText('e.g. Illidan');
        expect(realmInput).toBeDisabled();
    });

    it('applies opacity and cursor-not-allowed styling to Realm field for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const realmInput = screen.getByPlaceholderText('e.g. Illidan');
        expect(realmInput).toHaveClass('opacity-60');
        expect(realmInput).toHaveClass('cursor-not-allowed');
    });

    it('sets tooltip on Realm field explaining sync', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const realmInput = screen.getByPlaceholderText('e.g. Illidan');
        expect(realmInput).toHaveAttribute('title', 'This field is synced from the Blizzard Armory');
    });

    it('keeps the Role dropdown enabled for armory-synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const roleSelect = screen.getByRole('combobox');
        expect(roleSelect).not.toBeDisabled();
    });

    it('keeps the Main character checkbox enabled for armory-synced characters (when not already main)', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter({ isMain: false }) });
        const mainCheckbox = screen.getByRole('checkbox');
        // The checkbox is disabled only if editingCharacter.isMain is true (already main)
        // For a synced non-main character, the checkbox should be enabled
        expect(mainCheckbox).not.toBeDisabled();
    });

    it('shows LockClosedIcon on Name label for synced characters', () => {
        const { container } = renderModal({ editingCharacter: createArmorySyncedCharacter() });
        // The Name label contains a lock icon SVG
        const nameLabel = screen.getByText(/^Name/).closest('label');
        expect(nameLabel).toBeInTheDocument();
        const svgInLabel = nameLabel?.querySelector('svg');
        expect(svgInLabel).toBeInTheDocument();
    });

    it('shows LockClosedIcon on Class label for synced characters', () => {
        const { container } = renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const classLabel = screen.getByText(/^Class/).closest('label');
        expect(classLabel).toBeInTheDocument();
        const svgInLabel = classLabel?.querySelector('svg');
        expect(svgInLabel).toBeInTheDocument();
    });

    it('shows LockClosedIcon on Spec label for synced characters', () => {
        const { container } = renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const specLabel = screen.getByText(/^Spec/).closest('label');
        expect(specLabel).toBeInTheDocument();
        const svgInLabel = specLabel?.querySelector('svg');
        expect(svgInLabel).toBeInTheDocument();
    });

    it('shows LockClosedIcon on Realm label for synced characters', () => {
        const { container } = renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const realmLabel = screen.getByText(/^Realm\/Server/).closest('label');
        expect(realmLabel).toBeInTheDocument();
        const svgInLabel = realmLabel?.querySelector('svg');
        expect(svgInLabel).toBeInTheDocument();
    });

    it('pre-fills form fields with character data for synced characters', () => {
        const char = createArmorySyncedCharacter({
            name: 'Thrall',
            class: 'Shaman',
            spec: 'Elemental',
            realm: 'Illidan',
        });
        renderModal({ editingCharacter: char });
        expect(screen.getByPlaceholderText('Character name')).toHaveValue('Thrall');
        expect(screen.getByPlaceholderText('e.g. Warrior')).toHaveValue('Shaman');
        expect(screen.getByPlaceholderText('e.g. Arms')).toHaveValue('Elemental');
        expect(screen.getByPlaceholderText('e.g. Illidan')).toHaveValue('Illidan');
    });
});

describe('AddCharacterModal — manually-created character', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not show the armory sync info banner for manual characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        expect(
            screen.queryByText(/This character is synced from the Blizzard Armory/i)
        ).not.toBeInTheDocument();
    });

    it('keeps the Name field enabled for manually-created characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).not.toBeDisabled();
    });

    it('does not apply disabled styling to Name field for manual characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).not.toHaveClass('opacity-60');
        expect(nameInput).not.toHaveClass('cursor-not-allowed');
    });

    it('keeps the Class field enabled for manually-created characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const classInput = screen.getByPlaceholderText('e.g. Warrior');
        expect(classInput).not.toBeDisabled();
    });

    it('keeps the Spec field enabled for manually-created characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const specInput = screen.getByPlaceholderText('e.g. Arms');
        expect(specInput).not.toBeDisabled();
    });

    it('keeps the Realm field enabled for manually-created characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const realmInput = screen.getByPlaceholderText('e.g. Illidan');
        expect(realmInput).not.toBeDisabled();
    });

    it('keeps the Role dropdown enabled for manually-created characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const roleSelect = screen.getByRole('combobox');
        expect(roleSelect).not.toBeDisabled();
    });

    it('does not show LockClosedIcon on Name label for manual characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const nameLabel = screen.getByText(/^Name/).closest('label');
        expect(nameLabel).toBeInTheDocument();
        const svgInLabel = nameLabel?.querySelector('svg');
        expect(svgInLabel).toBeNull();
    });

    it('does not set tooltip on Name field for manual characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).not.toHaveAttribute('title');
    });

    it('pre-fills form fields with character data for manual characters', () => {
        const char = createManualCharacter({
            name: 'Jaina',
            class: 'Mage',
            spec: 'Frost',
            realm: 'Stormwind',
        });
        renderModal({ editingCharacter: char });
        expect(screen.getByPlaceholderText('Character name')).toHaveValue('Jaina');
        expect(screen.getByPlaceholderText('e.g. Warrior')).toHaveValue('Mage');
        expect(screen.getByPlaceholderText('e.g. Arms')).toHaveValue('Frost');
        expect(screen.getByPlaceholderText('e.g. Illidan')).toHaveValue('Stormwind');
    });
});

describe('AddCharacterModal — general edit behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the modal when isOpen is true', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        expect(screen.getByText('Edit Character')).toBeInTheDocument();
    });

    it('does not render when isOpen is false', () => {
        renderModal({ isOpen: false, editingCharacter: createManualCharacter() });
        expect(screen.queryByText('Edit Character')).not.toBeInTheDocument();
    });

    it('shows Save Changes button in edit mode', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        expect(screen.getByRole('button', { name: 'Save Changes' })).toBeInTheDocument();
    });

    it('shows Add Character button in create mode', () => {
        renderModal();
        expect(screen.getByRole('button', { name: 'Add Character' })).toBeInTheDocument();
    });

    it('shows the game name in static display when editing', () => {
        renderModal({
            editingCharacter: createManualCharacter(),
            gameId: 'game-uuid-wow',
            gameName: 'World of Warcraft',
        });
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });
});
