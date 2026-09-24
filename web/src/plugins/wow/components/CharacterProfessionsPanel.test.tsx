/**
 * Vitest — CharacterProfessionsPanel (ROK-1130).
 *
 * Visibility rules:
 *   • non-owner + no data  → render nothing
 *   • non-owner + has data → render the panel (read-only)
 *   • owner    + no data   → render an "Add Professions" CTA card
 *   • owner    + has data  → render the panel + an "Edit" affordance
 *
 * The real EditProfessionsModal renders here (its data hooks are mocked) so
 * the ROK-1655 Discard → reopen round trip is exercised end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CharacterProfessionsDto } from '@raid-ledger/contract';
import { CharacterProfessionsPanel } from './CharacterProfessionsPanel';

vi.mock('../lib/profession-icons', () => ({
    getProfessionIconUrl: (slug: string | null | undefined) => {
        if (slug === 'tailoring') return 'https://render.example/tailoring.jpg';
        if (slug === 'cooking') return 'https://render.example/cooking.jpg';
        return null;
    },
    professionNameToSlug: (name: string) =>
        name.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('../../../hooks/use-character-mutations', () => ({
    useUpdateCharacter: vi.fn(),
}));

vi.mock('../../../hooks/use-game-registry', () => ({
    useGameRegistry: vi.fn(),
}));

import { useUpdateCharacter } from '../../../hooks/use-character-mutations';
import { useGameRegistry } from '../../../hooks/use-game-registry';

beforeEach(() => {
    vi.mocked(useUpdateCharacter).mockReturnValue({
        mutate: vi.fn(),
        isPending: false,
    } as unknown as ReturnType<typeof useUpdateCharacter>);
    vi.mocked(useGameRegistry).mockReturnValue({
        games: [{ id: 1, slug: 'world-of-warcraft-cataclysm-classic' }],
        isLoading: false,
        error: null,
    } as unknown as ReturnType<typeof useGameRegistry>);
});

const TAILORING_WITH_TIER: CharacterProfessionsDto = {
    primary: [
        { id: 197, name: 'Tailoring', slug: 'tailoring', skillLevel: 450, maxSkillLevel: 450, tiers: [{ id: 2823, name: 'Dragon Isles Tailoring', skillLevel: 100, maxSkillLevel: 100 }] },
    ],
    secondary: [
        { id: 185, name: 'Cooking', slug: 'cooking', skillLevel: 150, maxSkillLevel: 150, tiers: [] },
    ],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

const EMPTY_PROFESSIONS: CharacterProfessionsDto = {
    primary: [],
    secondary: [],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

describe('CharacterProfessionsPanel — visibility short-circuit', () => {
    it('renders nothing when professions === null and viewer is NOT the owner', () => {
        const { container } = render(
            <CharacterProfessionsPanel professions={null} isOwner={false} characterId="c1" />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when both arrays are empty and viewer is NOT the owner', () => {
        const { container } = render(
            <CharacterProfessionsPanel professions={EMPTY_PROFESSIONS} isOwner={false} characterId="c1" />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe('CharacterProfessionsPanel — owner CTA when no data', () => {
    it('renders an "Add Professions" CTA when owner has no data', () => {
        render(<CharacterProfessionsPanel professions={null} isOwner characterId="c1" />);
        expect(screen.getByRole('heading', { name: /professions/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add professions/i })).toBeInTheDocument();
    });

    it('renders the CTA when owner has empty arrays (sync-with-no-data path)', () => {
        render(<CharacterProfessionsPanel professions={EMPTY_PROFESSIONS} isOwner characterId="c1" />);
        expect(screen.getByRole('button', { name: /add professions/i })).toBeInTheDocument();
    });
});

describe('CharacterProfessionsPanel — populated state', () => {
    it('renders primary, secondary, tiers, and skill numbers (non-owner)', () => {
        render(<CharacterProfessionsPanel professions={TAILORING_WITH_TIER} isOwner={false} characterId="c1" />);
        expect(screen.getByRole('heading', { name: /professions/i })).toBeInTheDocument();
        expect(screen.getByText('Tailoring')).toBeInTheDocument();
        expect(screen.getByText(/450\s*\/\s*450/)).toBeInTheDocument();
        expect(screen.getByText('Cooking')).toBeInTheDocument();
        expect(screen.getByText(/150\s*\/\s*150/)).toBeInTheDocument();
        expect(screen.getByText('Dragon Isles Tailoring')).toBeInTheDocument();
        expect(screen.getByText(/100\s*\/\s*100/)).toBeInTheDocument();
        // No edit affordance for non-owners
        expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull();
    });

    it('renders an Edit affordance for owners with data', () => {
        render(<CharacterProfessionsPanel professions={TAILORING_WITH_TIER} isOwner characterId="c1" />);
        expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
    });

    it('falls back to text-only when getProfessionIconUrl returns null', () => {
        const unknown: CharacterProfessionsDto = {
            primary: [{ id: 999, name: 'Mystery Craft', slug: 'mystery-craft', skillLevel: 25, maxSkillLevel: 100, tiers: [] }],
            secondary: [],
            syncedAt: '2026-04-28T00:00:00.000Z',
        };
        render(<CharacterProfessionsPanel professions={unknown} isOwner={false} characterId="c1" />);
        expect(screen.getByText('Mystery Craft')).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /mystery craft/i })).toBeNull();
    });
});

describe('CharacterProfessionsPanel — Discard really drops the draft (ROK-1655 AC1)', () => {
    const skillInputs = () => screen.getAllByRole('spinbutton', { name: /skill/i }) as HTMLInputElement[];

    it('reopening Edit after Discard shows the saved values, not the discarded draft', async () => {
        const user = userEvent.setup();
        render(<CharacterProfessionsPanel professions={TAILORING_WITH_TIER} isOwner characterId="c1" gameId={1} />);

        await user.click(screen.getByRole('button', { name: /^edit$/i }));
        expect(skillInputs()[0].value).toBe('450');
        await user.clear(skillInputs()[0]);
        await user.type(skillInputs()[0], '300');

        await user.keyboard('{Escape}');
        await user.click(screen.getByTestId('discard-changes-discard'));
        expect(screen.queryByRole('dialog', { name: 'Edit Professions' })).toBeNull();

        await user.click(screen.getByRole('button', { name: /^edit$/i }));
        expect(skillInputs()[0].value, 'Discard must drop the draft: reopen starts from the saved 450').toBe('450');
    });
});
