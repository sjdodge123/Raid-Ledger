/**
 * Vitest — CharacterCardCompact (ROK-1179 follow-up to ROK-1130).
 *
 * Covers the dual-prop API for ProfessionBadges data flow:
 *   • `character` prop carries `professions` → badges render
 *   • flat legacy `professions` prop → badges render
 *   • `character.professions` wins over flat prop
 *   • null/missing → no badge DOM
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type {
    CharacterDto,
    CharacterProfessionsDto,
} from '@raid-ledger/contract';
import { CharacterCardCompact } from './character-card-compact';
import { renderWithProviders } from '../../test/render-helpers';

vi.mock('../../plugins/wow/lib/profession-icons', () => ({
    getProfessionIconUrl: (slug: string | null | undefined) => {
        if (slug === 'tailoring') return 'https://render.example/tailoring.jpg';
        if (slug === 'cooking') return 'https://render.example/cooking.jpg';
        if (slug === 'mining') return 'https://render.example/mining.jpg';
        return null;
    },
    professionNameToSlug: (name: string) =>
        name.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('../../plugins/wow/lib/class-icons', () => ({
    getClassIconUrl: () => 'https://render.example/class.jpg',
}));

const PROFESSIONS_TAILORING: CharacterProfessionsDto = {
    primary: [
        { id: 197, name: 'Tailoring', slug: 'tailoring', skillLevel: 450, maxSkillLevel: 450, tiers: [] },
    ],
    secondary: [
        { id: 185, name: 'Cooking', slug: 'cooking', skillLevel: 150, maxSkillLevel: 150, tiers: [] },
    ],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

const PROFESSIONS_MINING: CharacterProfessionsDto = {
    primary: [
        { id: 186, name: 'Mining', slug: 'mining', skillLevel: 200, maxSkillLevel: 300, tiers: [] },
    ],
    secondary: [],
    syncedAt: '2026-04-28T00:00:00.000Z',
};

function makeCharacter(
    overrides: Partial<CharacterDto> = {},
): CharacterDto {
    return {
        id: '00000000-0000-0000-0000-000000000001',
        userId: 1,
        gameId: 1,
        name: 'Profsync',
        realm: 'Area 52',
        class: 'Mage',
        spec: 'Frost',
        role: 'dps',
        roleOverride: null,
        effectiveRole: 'dps',
        isMain: true,
        itemLevel: 480,
        externalId: null,
        avatarUrl: null,
        renderUrl: null,
        level: 80,
        race: 'Gnome',
        faction: 'alliance',
        lastSyncedAt: '2026-04-28T00:00:00.000Z',
        profileUrl: null,
        region: 'us',
        gameVariant: 'retail',
        equipment: null,
        talents: null,
        professions: null,
        displayOrder: 0,
        createdAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
        ...overrides,
    };
}

describe('CharacterCardCompact — ProfessionBadges data flow', () => {
    it('renders pills when `character.professions` is populated', () => {
        const character = makeCharacter({ professions: PROFESSIONS_TAILORING });
        renderWithProviders(<CharacterCardCompact character={character} />);
        expect(document.querySelector('[title="Tailoring 450/450"]')).not.toBeNull();
        expect(document.querySelector('[title="Cooking 150/150"]')).not.toBeNull();
    });

    it('renders pills when only the flat `professions` prop is set (legacy API)', () => {
        renderWithProviders(
            <CharacterCardCompact
                id="legacy-1"
                name="Legacy"
                professions={PROFESSIONS_MINING}
            />,
        );
        expect(document.querySelector('[title="Mining 200/300"]')).not.toBeNull();
    });

    it('prefers `character.professions` over the flat prop when both are passed', () => {
        const character = makeCharacter({ professions: PROFESSIONS_TAILORING });
        renderWithProviders(
            <CharacterCardCompact
                character={character}
                professions={PROFESSIONS_MINING}
            />,
        );
        expect(document.querySelector('[title="Tailoring 450/450"]')).not.toBeNull();
        expect(document.querySelector('[title="Mining 200/300"]')).toBeNull();
    });

    it('renders no profession DOM when both sources are null/missing', () => {
        const character = makeCharacter({ professions: null });
        renderWithProviders(<CharacterCardCompact character={character} />);
        expect(screen.queryByRole('img', { name: /tailoring/i })).toBeNull();
        expect(screen.queryByRole('img', { name: /cooking/i })).toBeNull();
        expect(screen.queryByRole('img', { name: /mining/i })).toBeNull();
    });
});
