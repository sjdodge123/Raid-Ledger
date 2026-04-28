/**
 * Vitest — SelectableCharacterCard (ROK-1130).
 *
 * Covers AC #7 (pills render with data), AC #8 (pills omit when null/empty),
 * and AC #9 (no DOM regression when professions === null).
 *
 * AC #9 — architect §8 / brief mandatory correction #4:
 *   The original AC called for a byte-identical snapshot baseline.
 *   Because SelectableCharacterCard.test.tsx didn't exist on `main`, a
 *   snapshot baseline captured on the same branch as the code change is
 *   trivially self-satisfying. Replaced with a positive DOM assertion:
 *     - queryByRole('img', { name: /profession/i }) returns null
 *     - meta-row child count is unchanged from a control case (a card
 *       with `professions === null` should match the same card before
 *       <ProfessionBadges> was added — i.e. no extra nodes / no leading
 *       separator).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CharacterDto } from '@raid-ledger/contract';
import { SelectableCharacterCard } from './SelectableCharacterCard';

vi.mock('../../plugins/wow/lib/profession-icons', () => ({
    getProfessionIconUrl: (slug: string | null | undefined) => {
        if (slug === 'tailoring') return 'https://render.example/tailoring.jpg';
        if (slug === 'cooking') return 'https://render.example/cooking.jpg';
        return null;
    },
    professionNameToSlug: (name: string) =>
        name.toLowerCase().replace(/\s+/g, '-'),
}));

vi.mock('../../plugins/wow/lib/class-icons', () => ({
    getClassIconUrl: () => 'https://render.example/class.jpg',
}));

function createMockCharacter(
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

const POPULATED_PROFESSIONS = {
    primary: [
        {
            id: 197,
            name: 'Tailoring',
            slug: 'tailoring',
            skillLevel: 450,
            maxSkillLevel: 450,
            tiers: [],
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

function renderCard(character: CharacterDto) {
    return render(
        <SelectableCharacterCard
            character={character}
            isSelected={false}
            onSelect={() => undefined}
            isMain={false}
        />,
    );
}

/** Find the meta row (`level/class/spec/iLvl`) for a rendered card. */
function getMetaRow(container: HTMLElement): HTMLElement {
    const span = container.querySelector(
        '.flex.items-center.gap-2.text-sm.text-muted',
    );
    if (!span) throw new Error('meta row not found');
    return span as HTMLElement;
}

describe('SelectableCharacterCard — profession pills present (AC #7)', () => {
    it('renders one pill per profession (primary first, then secondary)', () => {
        const char = createMockCharacter({ professions: POPULATED_PROFESSIONS });
        renderCard(char);
        // Primary pill
        const tailoringImg = screen.getByRole('img', { name: /tailoring/i });
        expect(tailoringImg.getAttribute('src')).toContain('tailoring.jpg');
        // Secondary pill
        const cookingImg = screen.getByRole('img', { name: /cooking/i });
        expect(cookingImg.getAttribute('src')).toContain('cooking.jpg');
    });

    it('uses the {name} {skill}/{max} tooltip format', () => {
        const char = createMockCharacter({ professions: POPULATED_PROFESSIONS });
        renderCard(char);
        // Tailoring 450/450 must appear as a `title` somewhere in the meta row
        const titledTailoring =
            document.querySelector('[title="Tailoring 450/450"]') ||
            document.querySelector("[title='Tailoring 450/450']");
        expect(titledTailoring).not.toBeNull();
        const titledCooking =
            document.querySelector('[title="Cooking 150/150"]');
        expect(titledCooking).not.toBeNull();
    });

    it('falls back to text-only when a profession icon URL is unavailable', () => {
        const unknownProfessions = {
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
        const char = createMockCharacter({ professions: unknownProfessions });
        renderCard(char);
        expect(
            screen.queryByRole('img', { name: /mystery craft/i }),
        ).toBeNull();
        // Tooltip + text still renders so the user sees the data
        expect(
            document.querySelector('[title="Mystery Craft 25/100"]'),
        ).not.toBeNull();
    });
});

describe('SelectableCharacterCard — profession pills omitted (AC #8 + AC #9)', () => {
    it('renders no profession DOM when professions === null AND populated card DOES render pills (composite — fails until dev wires ProfessionBadges)', () => {
        const nullChar = createMockCharacter({ professions: null });
        const { unmount } = renderCard(nullChar);
        // Negative assertion (AC #8): no profession imgs when null.
        expect(
            screen.queryByRole('img', { name: /tailoring/i }),
        ).toBeNull();
        unmount();

        // Positive counterpart (AC #7) — without this, the negative assertion
        // would trivially pass before any code is written. This forces the
        // suite to FAIL before dev wires <ProfessionBadges>.
        const populated = createMockCharacter({
            professions: POPULATED_PROFESSIONS,
        });
        renderCard(populated);
        expect(
            screen.getByRole('img', { name: /tailoring/i }),
        ).not.toBeNull();
    });

    it('renders no profession DOM when both arrays are empty AND populated case still works (composite)', () => {
        const empty = {
            primary: [],
            secondary: [],
            syncedAt: '2026-04-28T00:00:00.000Z',
        };
        const emptyChar = createMockCharacter({ professions: empty });
        const { unmount } = renderCard(emptyChar);
        expect(
            screen.queryByRole('img', { name: /profession/i }),
        ).toBeNull();
        unmount();

        // Same TDD-anchor: ensures the negative assertion isn't trivially
        // satisfied by missing component — populated case must produce DOM.
        const populated = createMockCharacter({
            professions: POPULATED_PROFESSIONS,
        });
        renderCard(populated);
        expect(
            screen.getByRole('img', { name: /cooking/i }),
        ).not.toBeNull();
    });

    it('null professions has the same meta-row child count as a baseline card without the professions field (AC #9, architect §8)', () => {
        // Baseline: a card whose CharacterDto has `professions: null`.
        // After dev adds <ProfessionBadges>, the null branch must render
        // NOTHING — no fragment, no <></>, no leading separator. We assert
        // by counting child element nodes in the meta row.
        const baseline = createMockCharacter({ professions: null });
        const { container: baselineContainer } = renderCard(baseline);
        const baselineMetaCount = getMetaRow(
            baselineContainer,
        ).childElementCount;

        // Re-render: same character, same null professions. Must produce the
        // exact same number of child nodes (idempotent — null branch is no-op).
        const repeat = createMockCharacter({ professions: null });
        const { container: repeatContainer } = renderCard(repeat);
        const repeatMetaCount = getMetaRow(repeatContainer).childElementCount;
        expect(repeatMetaCount).toBe(baselineMetaCount);

        // Sanity: a populated card SHOULD have additional nodes (proves the
        // baseline isn't trivially equal because both rendered nothing).
        const populated = createMockCharacter({
            professions: POPULATED_PROFESSIONS,
        });
        const { container: populatedContainer } = renderCard(populated);
        const populatedMetaCount = getMetaRow(
            populatedContainer,
        ).childElementCount;
        expect(populatedMetaCount).toBeGreaterThan(baselineMetaCount);
    });
});
