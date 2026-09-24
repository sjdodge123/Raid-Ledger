import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AddCharacterModal } from './AddCharacterModal';
import { useCreateCharacter } from '../../hooks/use-character-mutations';
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
                id: 1,
                name: 'World of Warcraft',
                slug: 'world-of-warcraft',
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
    gameId: 1,
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
    gameId: 1,
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
        gameId: 1,
        gameName: 'World of Warcraft',
    };

    return render(
        <QueryClientProvider client={createQueryClient()}>
            <AddCharacterModal {...defaultProps} {...props} />
        </QueryClientProvider>
    );
}

/**
 * The element that carries the Armory lock icon for a field: a Field hint that
 * describes the input (aria-describedby), or null when there is none.
 */
function lockHintFor(name: string): HTMLElement | null {
    const input = screen.getByRole('textbox', { name });
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
    const described = ids.map((id) => document.getElementById(id));
    return described.find((el) => el?.querySelector('svg')) ?? null;
}

describe('AddCharacterModal — armory-synced character — part 1', () => {
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

    it('disables the Realm field for armory-synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        const realmInput = screen.getByPlaceholderText('e.g. Illidan');
        expect(realmInput).toBeDisabled();
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

});

describe('AddCharacterModal — armory-synced character — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps the Main character checkbox enabled for armory-synced characters (when not already main)', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter({ isMain: false }) });
        const mainCheckbox = screen.getByRole('checkbox');
        // The checkbox is disabled only if editingCharacter.isMain is true (already main)
        // For a synced non-main character, the checkbox should be enabled
        expect(mainCheckbox).not.toBeDisabled();
    });

    it('shows LockClosedIcon in the Name field hint for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        // ROK-1648: Field's label is a string, so the lock moves into the hint that describes the input.
        expect(lockHintFor('Name'), 'a lock-icon hint should describe the Name input').not.toBeNull();
    });

    it('shows LockClosedIcon in the Class field hint for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        // ROK-1648: Field's label is a string, so the lock moves into the hint that describes the input.
        expect(lockHintFor('Class'), 'a lock-icon hint should describe the Class input').not.toBeNull();
    });

    it('shows LockClosedIcon in the Spec field hint for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        // ROK-1648: Field's label is a string, so the lock moves into the hint that describes the input.
        expect(lockHintFor('Spec'), 'a lock-icon hint should describe the Spec input').not.toBeNull();
    });

    it('shows LockClosedIcon in the Realm field hint for synced characters', () => {
        renderModal({ editingCharacter: createArmorySyncedCharacter() });
        // ROK-1648: Field's label is a string, so the lock moves into the hint that describes the input.
        expect(lockHintFor('Realm/Server'), 'a lock-icon hint should describe the Realm/Server input').not.toBeNull();
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

describe('AddCharacterModal — manually-created character — part 1', () => {
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
        expect(lockHintFor('Name'), 'no lock-icon hint for a manual character').toBeNull();
    });

    it('does not set tooltip on Name field for manual characters', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const nameInput = screen.getByPlaceholderText('Character name');
        expect(nameInput).not.toHaveAttribute('title');
    });

});

describe('AddCharacterModal — manually-created character — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
            gameId: 1,
            gameName: 'World of Warcraft',
        });
        expect(screen.getByText('World of Warcraft')).toBeInTheDocument();
    });
});

describe('AddCharacterModal — form primitives (ROK-1648)', () => {
    const defaultCreate = () => ({ mutate: vi.fn(), isPending: false });

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(useCreateCharacter).mockImplementation(defaultCreate as never);
    });

    it('an empty name sets aria-invalid on Name and shows the Field error, not a form alert', () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: 'Add Character' }));
        const nameInput = screen.getByRole('textbox', { name: 'Name' });
        expect(nameInput).toHaveAttribute('aria-invalid', 'true');
        const alerts = screen.getAllByRole('alert');
        expect(alerts, 'only the Name Field error should announce').toHaveLength(1);
        expect(alerts[0]).toHaveTextContent('Character name is required');
        expect(nameInput.getAttribute('aria-describedby') ?? '', 'the error should describe the Name input').toContain(alerts[0].id);
    });

    it('with no game picked, the game search shows "Please select a game" and no alert', () => {
        renderModal({ gameId: undefined, gameName: undefined });
        fireEvent.click(screen.getByRole('button', { name: 'Add Character' }));
        expect(screen.getByTestId('game-search-error')).toHaveTextContent('Please select a game');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('a failed save renders the mutation error as a text-danger form alert', () => {
        const mutate = vi.fn((_dto: unknown, opts?: { onError?: (e: Error) => void }) => opts?.onError?.(new Error('Name already taken')));
        vi.mocked(useCreateCharacter).mockImplementation((() => ({ mutate, isPending: false })) as never);
        renderModal();
        fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Thrall' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add Character' }));
        expect(mutate).toHaveBeenCalledTimes(1);
        const alert = screen.queryByRole('alert');
        expect(alert, 'the mutation error should render as role=alert').not.toBeNull();
        expect(alert).toHaveTextContent('Name already taken');
        expect(alert).toHaveClass('text-danger');
        expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('the submit is a loading Button while a save is pending (aria-busy, not native disabled)', () => {
        vi.mocked(useCreateCharacter).mockImplementation((() => ({ mutate: vi.fn(), isPending: true })) as never);
        renderModal();
        const submit = document.querySelector('button[type="submit"]') as HTMLElement;
        expect(submit, 'the form keeps one submit button').not.toBeNull();
        expect(submit).toHaveAttribute('aria-busy', 'true');
        expect(submit).toHaveAccessibleName('Saving…');
        expect(submit).toHaveAttribute('aria-disabled', 'true');
            });

    it('Role is a labelled Select with the "Select role..." placeholder', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        const role = screen.getByRole('combobox', { name: 'Role' });
        expect(role).toHaveDisplayValue('DPS');
        expect(screen.getByRole('option', { name: 'Select role...' })).toHaveValue('');
    });

    it('the Main character note is the checkbox description, not part of its name', () => {
        renderModal({ editingCharacter: createManualCharacter({ isMain: true }) });
        const main = screen.getByRole('checkbox');
        expect(main).toHaveAccessibleName('Main character');
        expect(main).toBeDisabled();
        expect(main).toHaveAccessibleDescription('(already main)');
    });

    it('the read-only Game caption is plain text, not an orphan <label>', () => {
        renderModal({ editingCharacter: createManualCharacter() });
        expect(screen.getByText('Game', { exact: true }).closest('label')).toBeNull();
    });
});
