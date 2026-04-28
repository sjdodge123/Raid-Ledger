/**
 * Vitest — CharacterProfessionsPanel (ROK-1130).
 *
 * Covers AC #5 (renders with data) and AC #6 (empty/null states).
 * Also covers the icon-fallback case — when `getProfessionIconUrl`
 * returns null the component should render text only without a broken
 * `<img>`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const TAILORING_WITH_TIER: CharacterProfessionsDto = {
    primary: [
        {
            id: 197,
            name: 'Tailoring',
            slug: 'tailoring',
            skillLevel: 450,
            maxSkillLevel: 450,
            tiers: [
                {
                    id: 2823,
                    name: 'Dragon Isles Tailoring',
                    skillLevel: 100,
                    maxSkillLevel: 100,
                },
            ],
        },
    ],
    secondary: [
        {
            id: 185,
            name: 'Cooking',
            slug: 'cooking',
            skillLevel: 150,
            maxSkillLevel: 150,
            tiers: [],
        },
    ],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

describe('CharacterProfessionsPanel — empty / null states (AC #6)', () => {
    it('renders the never-synced empty hint when professions === null and not armory-imported', () => {
        render(
            <CharacterProfessionsPanel
                professions={null}
                isArmoryImported={false}
            />,
        );
        expect(
            screen.getByRole('heading', { name: /professions/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/armory|import|sync/i),
        ).toBeInTheDocument();
    });

    it('renders an empty hint when professions === null and armory-imported (different copy)', () => {
        render(
            <CharacterProfessionsPanel
                professions={null}
                isArmoryImported={true}
            />,
        );
        expect(
            screen.getByRole('heading', { name: /professions/i }),
        ).toBeInTheDocument();
    });

    it('renders "no professions" copy when both arrays are empty', () => {
        const empty: CharacterProfessionsDto = {
            primary: [],
            secondary: [],
            syncedAt: '2026-04-28T00:00:00.000Z',
        };
        render(
            <CharacterProfessionsPanel
                professions={empty}
                isArmoryImported={true}
            />,
        );
        expect(
            screen.getByRole('heading', { name: /professions/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/no professions/i),
        ).toBeInTheDocument();
    });
});

describe('CharacterProfessionsPanel — populated state (AC #5)', () => {
    it('renders primary, secondary, tiers, and skill numbers', () => {
        render(
            <CharacterProfessionsPanel
                professions={TAILORING_WITH_TIER}
                isArmoryImported={true}
            />,
        );

        // Primary profession name + skill text
        expect(screen.getByText('Tailoring')).toBeInTheDocument();
        expect(screen.getByText(/450\s*\/\s*450/)).toBeInTheDocument();

        // Secondary profession name + skill text
        expect(screen.getByText('Cooking')).toBeInTheDocument();
        expect(screen.getByText(/150\s*\/\s*150/)).toBeInTheDocument();

        // Tier entry
        expect(screen.getByText('Dragon Isles Tailoring')).toBeInTheDocument();
        expect(screen.getByText(/100\s*\/\s*100/)).toBeInTheDocument();

        // Profession icons rendered (one per profession with a known slug)
        const tailoringImg = screen.getByAltText(/tailoring/i);
        expect(tailoringImg.getAttribute('src')).toContain('tailoring.jpg');
    });

    it('falls back to text-only when getProfessionIconUrl returns null', () => {
        const unknown: CharacterProfessionsDto = {
            primary: [
                {
                    id: 999,
                    name: 'Mystery Craft',
                    slug: 'mystery-craft',
                    skillLevel: 25,
                    maxSkillLevel: 100,
                    tiers: [],
                },
            ],
            secondary: [],
            syncedAt: '2026-04-28T00:00:00.000Z',
        };
        render(
            <CharacterProfessionsPanel
                professions={unknown}
                isArmoryImported={true}
            />,
        );
        expect(screen.getByText('Mystery Craft')).toBeInTheDocument();
        // No <img> should render with the unknown slug as alt text.
        expect(
            screen.queryByRole('img', { name: /mystery craft/i }),
        ).toBeNull();
    });
});
