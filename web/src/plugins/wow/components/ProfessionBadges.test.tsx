/**
 * Vitest — ProfessionBadges (ROK-1179 follow-up to ROK-1130).
 *
 * Covers:
 *   • null / undefined / empty arrays → empty DOM (no fragment, no separator)
 *   • populated → one <img> per profession (primary first, then secondary)
 *   • custom separator renders verbatim
 *   • icon-less slug falls back to text
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CharacterProfessionsDto } from '@raid-ledger/contract';
import { ProfessionBadges } from './ProfessionBadges';

vi.mock('../lib/profession-icons', () => ({
    getProfessionIconUrl: (slug: string | null | undefined) => {
        if (slug === 'tailoring') return 'https://render.example/tailoring.jpg';
        if (slug === 'cooking') return 'https://render.example/cooking.jpg';
        if (slug === 'mining') return 'https://render.example/mining.jpg';
        return null;
    },
}));

const POPULATED: CharacterProfessionsDto = {
    primary: [
        { id: 197, name: 'Tailoring', slug: 'tailoring', skillLevel: 450, maxSkillLevel: 450, tiers: [] },
        { id: 186, name: 'Mining', slug: 'mining', skillLevel: 450, maxSkillLevel: 450, tiers: [] },
    ],
    secondary: [
        { id: 185, name: 'Cooking', slug: 'cooking', skillLevel: 150, maxSkillLevel: 150, tiers: [] },
    ],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

const EMPTY: CharacterProfessionsDto = {
    primary: [],
    secondary: [],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

describe('ProfessionBadges — empty DOM short-circuits', () => {
    it('renders nothing when professions is null', () => {
        const { container } = render(<ProfessionBadges professions={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when professions is undefined', () => {
        const { container } = render(<ProfessionBadges professions={undefined} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when both arrays are empty', () => {
        const { container } = render(<ProfessionBadges professions={EMPTY} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('ProfessionBadges — populated', () => {
    it('renders one <img> per profession (primary first, then secondary)', () => {
        render(<ProfessionBadges professions={POPULATED} />);
        const imgs = screen.getAllByRole('img');
        expect(imgs).toHaveLength(3);
        // Order: primary first (Tailoring, Mining), then secondary (Cooking).
        expect(imgs[0].getAttribute('alt')).toBe('Tailoring');
        expect(imgs[1].getAttribute('alt')).toBe('Mining');
        expect(imgs[2].getAttribute('alt')).toBe('Cooking');
    });

    it('uses the {name} {skill}/{max} title format', () => {
        render(<ProfessionBadges professions={POPULATED} />);
        expect(document.querySelector('[title="Tailoring 450/450"]')).not.toBeNull();
        expect(document.querySelector('[title="Cooking 150/150"]')).not.toBeNull();
    });

    it('renders the custom separator verbatim before each pill', () => {
        const { container } = render(
            <ProfessionBadges professions={POPULATED} separator="|" />,
        );
        // Separator is one <span> per pill; populated has 3 entries → 3 separators.
        const separators = Array.from(container.querySelectorAll('span')).filter(
            (s) => s.textContent === '|',
        );
        expect(separators).toHaveLength(3);
    });

    it('defaults the separator to a middle dot', () => {
        const { container } = render(<ProfessionBadges professions={POPULATED} />);
        const dots = Array.from(container.querySelectorAll('span')).filter(
            (s) => s.textContent === '·',
        );
        expect(dots).toHaveLength(3);
    });

    it('falls back to text-only when getProfessionIconUrl returns null', () => {
        const unknown: CharacterProfessionsDto = {
            primary: [
                { id: 999, name: 'Mystery Craft', slug: 'mystery-craft', skillLevel: 25, maxSkillLevel: 100, tiers: [] },
            ],
            secondary: [],
            syncedAt: '2026-04-28T00:00:00.000Z',
        };
        render(<ProfessionBadges professions={unknown} />);
        expect(screen.queryByRole('img', { name: /mystery craft/i })).toBeNull();
        expect(document.querySelector('[title="Mystery Craft 25/100"]')).not.toBeNull();
    });
});
