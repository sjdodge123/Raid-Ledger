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
import { screen } from '@testing-library/react';
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
