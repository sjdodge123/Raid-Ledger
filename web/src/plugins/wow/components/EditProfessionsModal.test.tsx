/**
 * Vitest — EditProfessionsModal (ROK-1179 follow-up to ROK-1130).
 *
 * Covers:
 *   • Empty initial render — both Add buttons visible, no rows
 *   • Era filtering — vanilla excludes Cooking-from-primary (Cooking is
 *     secondary), and the BC anniversary edition excludes Archaeology
 *     from secondary (Archaeology was added in Cataclysm)
 *   • Save calls useUpdateCharacter().mutate with the right DTO,
 *     including a `null` payload when both arrays are empty
 *   • Backspace-past-zero (commit b3a3dfd8) — `initial.skillLevel === 0`
 *     renders an empty input (placeholder shows), and clearing the input
 *     leaves an empty string (not "0"). Use `userEvent`, not `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
    CharacterProfessionsDto,
    GameRegistryDto,
} from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';

vi.mock('../../../hooks/use-character-mutations', () => ({
    useUpdateCharacter: vi.fn(),
}));

vi.mock('../../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(),
}));

vi.mock('../lib/profession-icons', () => ({
    getProfessionIconUrl: () => null,
    professionNameToSlug: (name: string) =>
        name.toLowerCase().replace(/\s+/g, '-'),
}));

import { useUpdateCharacter } from '../../../hooks/use-character-mutations';
import { useGameRegistry } from '../../../hooks/use-game-registry';
import { EditProfessionsModal } from './EditProfessionsModal';

const mutate = vi.fn();

function makeGame(overrides: Partial<GameRegistryDto> = {}): GameRegistryDto {
    return {
        id: 1,
        slug: 'world-of-warcraft-cataclysm-classic',
        name: 'WoW Cataclysm Classic',
        shortName: 'Cata',
        coverUrl: null,
        colorHex: null,
        hasRoles: true,
        hasSpecs: true,
        enabled: true,
        maxCharactersPerUser: 50,
        genres: [],
        ...overrides,
    };
}

function setEraFromSlug(slug: string) {
    vi.mocked(useGameRegistry).mockReturnValue({
        games: [makeGame({ slug })],
        isLoading: false,
        error: null,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockReset();
    vi.mocked(useUpdateCharacter).mockReturnValue({
        mutate,
        isPending: false,
    } as unknown as ReturnType<typeof useUpdateCharacter>);
    setEraFromSlug('world-of-warcraft-cataclysm-classic');
});

const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    characterId: 'char-1',
    gameId: 1,
};

describe('EditProfessionsModal — empty initial render', () => {
    it('shows Add buttons for both primary and secondary when initial is null', () => {
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={null} />,
        );
        expect(
            screen.getByRole('button', { name: /add primary/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: /add secondary/i }),
        ).toBeInTheDocument();
        // No rows rendered: zero combobox / zero spinbutton.
        expect(
            screen.queryAllByRole('combobox', { name: /profession/i }),
        ).toHaveLength(0);
        expect(
            screen.queryAllByRole('spinbutton', { name: /skill/i }),
        ).toHaveLength(0);
    });
});

describe('EditProfessionsModal — era filtering', () => {
    it('vanilla primary excludes Cooking (Cooking is always secondary, not primary)', async () => {
        setEraFromSlug('world-of-warcraft-classic');
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={null} />,
        );
        await user.click(screen.getByRole('button', { name: /add primary/i }));
        const select = screen.getByRole('combobox', { name: /profession/i });
        const optionTexts = Array.from(select.querySelectorAll('option')).map(
            (o) => o.textContent,
        );
        expect(optionTexts).toContain('Tailoring');
        expect(optionTexts).toContain('Mining');
        expect(optionTexts).not.toContain('Cooking');
        // Vanilla also excludes Jewelcrafting / Inscription — sanity check.
        expect(optionTexts).not.toContain('Jewelcrafting');
        expect(optionTexts).not.toContain('Inscription');
    });

    it('BC anniversary edition secondary excludes Archaeology (added in Cataclysm)', async () => {
        setEraFromSlug(
            'world-of-warcraft-burning-crusade-classic-anniversary-edition',
        );
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={null} />,
        );
        await user.click(screen.getByRole('button', { name: /add secondary/i }));
        const select = screen.getByRole('combobox', { name: /profession/i });
        const optionTexts = Array.from(select.querySelectorAll('option')).map(
            (o) => o.textContent,
        );
        expect(optionTexts).toContain('Cooking');
        expect(optionTexts).toContain('Fishing');
        expect(optionTexts).toContain('First Aid');
        expect(optionTexts).not.toContain('Archaeology');
    });
});

describe('EditProfessionsModal — Save calls useUpdateCharacter().mutate', () => {
    it('passes a null professions payload when both primary and secondary are empty', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={null} />,
        );
        await user.click(screen.getByRole('button', { name: /^save$/i }));
        expect(mutate).toHaveBeenCalledTimes(1);
        const [payload] = mutate.mock.calls[0];
        expect(payload).toEqual({
            id: 'char-1',
            dto: { professions: null },
        });
    });

    it('passes a populated DTO when the user fills in a profession row', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={null} />,
        );
        await user.click(screen.getByRole('button', { name: /add primary/i }));
        const select = screen.getByRole('combobox', { name: /profession/i });
        await user.selectOptions(select, 'Tailoring');
        const skillInput = screen.getByRole('spinbutton', { name: /skill/i });
        await user.type(skillInput, '450');

        await user.click(screen.getByRole('button', { name: /^save$/i }));

        expect(mutate).toHaveBeenCalledTimes(1);
        const [payload] = mutate.mock.calls[0];
        expect(payload.id).toBe('char-1');
        expect(payload.dto.professions).not.toBeNull();
        expect(payload.dto.professions.primary).toHaveLength(1);
        expect(payload.dto.professions.primary[0].name).toBe('Tailoring');
        expect(payload.dto.professions.primary[0].slug).toBe('tailoring');
        expect(payload.dto.professions.primary[0].skillLevel).toBe(450);
        expect(payload.dto.professions.secondary).toHaveLength(0);
    });
});

describe('EditProfessionsModal — backspace-past-zero (regression for commit b3a3dfd8)', () => {
    /** A profession entry with skillLevel === 0 must surface as an empty
     * input (placeholder shows) — not as a literal "0" — so the user can
     * type a fresh value without first deleting a leading zero. */
    const ZERO_SKILL: CharacterProfessionsDto = {
        primary: [
            {
                id: 1,
                name: 'Tailoring',
                slug: 'tailoring',
                skillLevel: 0,
                maxSkillLevel: 525,
                tiers: [],
            },
        ],
        secondary: [],
        syncedAt: '2026-04-28T00:00:00.000Z',
    };

    it('renders skillLevel:0 as an empty input (placeholder visible)', () => {
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={ZERO_SKILL} />,
        );
        const skillInput = screen.getByRole('spinbutton', {
            name: /skill/i,
        }) as HTMLInputElement;
        expect(skillInput.value).toBe('');
        expect(skillInput.placeholder).toBe('0');
    });

    it('clearing a non-zero input leaves "" (not "0") so backspace-past-zero works', async () => {
        const user = userEvent.setup();
        const populated: CharacterProfessionsDto = {
            primary: [
                {
                    id: 1,
                    name: 'Tailoring',
                    slug: 'tailoring',
                    skillLevel: 250,
                    maxSkillLevel: 525,
                    tiers: [],
                },
            ],
            secondary: [],
            syncedAt: '2026-04-28T00:00:00.000Z',
        };
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={populated} />,
        );
        const skillInput = screen.getByRole('spinbutton', {
            name: /skill/i,
        }) as HTMLInputElement;
        expect(skillInput.value).toBe('250');
        await user.clear(skillInput);
        expect(skillInput.value).toBe('');
    });
});

describe('EditProfessionsModal — shared primitives (ROK-1654 H3)', () => {
    const TWO_PRIMARY: CharacterProfessionsDto = {
        primary: [
            { id: 1, name: 'Tailoring', slug: 'tailoring', skillLevel: 250, maxSkillLevel: 525, tiers: [] },
            { id: 2, name: 'Mining', slug: 'mining', skillLevel: 100, maxSkillLevel: 525, tiers: [] },
        ],
        secondary: [],
        syncedAt: '2026-04-28T00:00:00.000Z',
    };

    it('Remove profession is a named button with a decorative icon, and removes its row', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={TWO_PRIMARY} />,
        );
        expect(screen.getAllByRole('combobox', { name: /profession/i })).toHaveLength(2);
        const removeButtons = screen.getAllByRole('button', { name: 'Remove profession' });
        expect(removeButtons).toHaveLength(2);
        expect(removeButtons[0].querySelector('svg[aria-hidden="true"]')).not.toBeNull();
        expect(removeButtons[0].textContent).not.toContain('✕');

        await user.click(removeButtons[0]);

        const remaining = screen.getAllByRole('combobox', { name: /profession/i });
        expect(remaining).toHaveLength(1);
        expect((remaining[0] as HTMLSelectElement).value).toBe('Mining');
    });

    it('Save is a loading button while the mutation is pending: aria-busy, and a click does not call mutate', async () => {
        vi.mocked(useUpdateCharacter).mockReturnValue({
            mutate,
            isPending: true,
        } as unknown as ReturnType<typeof useUpdateCharacter>);
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={null} />,
        );
        const save = screen.getByRole('button', { name: /^sav(e|ing)/i });
        expect(save).toHaveAttribute('aria-busy', 'true');

        await user.click(save);

        expect(mutate).not.toHaveBeenCalled();
    });

    it('carries no hardcoded indigo / red hover colours (tokens and primitive defaults only)', async () => {
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} initial={TWO_PRIMARY} />,
        );
        await user.click(screen.getByRole('button', { name: /add secondary/i }));
        const offending = Array.from(document.body.querySelectorAll('[class]'))
            .map((el) => el.getAttribute('class') ?? '')
            .filter((c) => /indigo-|hover:text-red-/.test(c));
        expect(offending).toEqual([]);
    });
});

describe('EditProfessionsModal — dirty-close guard + pinned footer (ROK-1655 AC1/AC2)', () => {
    const CONFIRM_TITLE = 'Discard your changes?';
    const confirmDialog = () => screen.queryByRole('dialog', { name: CONFIRM_TITLE });

    function renderModal(onClose = vi.fn()) {
        const user = userEvent.setup();
        renderWithProviders(
            <EditProfessionsModal {...baseProps} onClose={onClose} initial={null} />,
        );
        return { user, onClose };
    }

    async function makeDirty(user: ReturnType<typeof userEvent.setup>) {
        await user.click(screen.getByRole('button', { name: /add primary/i }));
        await user.selectOptions(screen.getByRole('combobox', { name: /profession/i }), 'Tailoring');
    }

    /** The guard latches for one macrotask after Keep so the same Escape cannot re-open it. */
    const flushGuardLatch = () => new Promise((resolve) => setTimeout(resolve, 0));

    it('Save and Cancel sit in the pinned modal footer, outside the scroll body', () => {
        renderModal();
        const footer = screen.queryByTestId('modal-footer');
        expect(footer, 'Save/Cancel must render in the pinned Modal footer').not.toBeNull();
        expect(within(footer as HTMLElement).getByRole('button', { name: /^save$/i })).toBeInTheDocument();
        expect(within(footer as HTMLElement).getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
        expect((footer as HTMLElement).contains(screen.getByRole('button', { name: /add primary/i }))).toBe(false);
    });

    it('clean form: Escape closes at once, with no discard confirm', async () => {
        const { user, onClose } = renderModal();
        await user.keyboard('{Escape}');
        expect(confirmDialog()).toBeNull();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('dirty form: Escape asks first; Keep editing keeps the draft, Discard closes once', async () => {
        const { user, onClose } = renderModal();
        await makeDirty(user);

        await user.keyboard('{Escape}');
        expect(confirmDialog(), 'Escape on a dirty form must ask "Discard your changes?"').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();

        await user.click(screen.getByTestId('discard-changes-keep'));
        expect(confirmDialog()).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
        expect((screen.getByRole('combobox', { name: /profession/i }) as HTMLSelectElement).value).toBe('Tailoring');

        await flushGuardLatch();
        await user.keyboard('{Escape}');
        expect(confirmDialog(), 'a second Escape must ask again').not.toBeNull();
        await user.click(screen.getByTestId('discard-changes-discard'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['Cancel', () => screen.getByRole('button', { name: /^cancel$/i })],
        ['the × close button', () => screen.getByRole('button', { name: 'Close modal' })],
    ])('dirty form: %s asks before closing', async (_label, target) => {
        const { user, onClose } = renderModal();
        await makeDirty(user);
        await user.click(target());
        expect(confirmDialog(), 'a dirty close must ask "Discard your changes?"').not.toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('Save on a dirty form never prompts: mutate runs and onSuccess closes', async () => {
        mutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.());
        const { user, onClose } = renderModal();
        await makeDirty(user);
        await user.click(screen.getByRole('button', { name: /^save$/i }));
        expect(mutate).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(confirmDialog()).toBeNull();
    });
});
