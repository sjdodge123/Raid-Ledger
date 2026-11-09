/**
 * Character detail page smoke tests — header info, metadata badges, sections.
 *
 * ROK-905: Verify the character detail page renders correctly at both
 * desktop and mobile viewports. ROK-2112: the character is seeded per
 * project + worker + run via `POST /admin/test/wow/seed-guild`.
 */
import type { TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';
import { defined } from './defined';

interface SeedCharacter {
    id: string;
    name: string;
    class: string | null;
    spec: string | null;
    race: string | null;
    level: number | null;
    itemLevel: number | null;
    professions?: {
        primary: Array<{
            name: string;
            skillLevel: number;
            maxSkillLevel: number;
        }>;
        secondary: Array<{
            name: string;
            skillLevel: number;
            maxSkillLevel: number;
        }>;
        syncedAt: string;
    } | null;
    /** ROK-2107 — provenance of the effective `professions`. */
    professionsSource?: 'manual' | 'blizzard' | null;
    gameVariant?: string | null;
}

/** Seeded GM's Armory professions (ROK-2107): one primary, distinctive skill. */
const SEED_PROFESSIONS = {
    primary: [
        {
            id: 164,
            name: 'Blacksmithing',
            slug: 'blacksmithing',
            skillLevel: 275,
            maxSkillLevel: 300,
            tiers: [],
        },
    ],
    secondary: [],
    syncedAt: new Date().toISOString(),
};

interface SeededGuild {
    users: Record<string, { userId: number; characterId: string | null }>;
}

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    const project = testInfo.project.name.replace(/[^A-Za-z0-9 _-]/g, '-');
    return `Chardetail ${project} w${testInfo.workerIndex} ${Date.now()}`;
}

/**
 * ROK-2112 — seed our own character instead of hunting the shared seed (which
 * has none with class + level or professions after reset-to-seed, so every
 * test used to skip). `seed-guild` gives the GM a level-60 Warrior with
 * Armory professions; the detail page is public, so admin views it directly.
 * A missing seed throws — it never skips.
 */
async function seedCharacter(
    token: string,
    testInfo: TestInfo,
): Promise<{ guild: SeededGuild; character: SeedCharacter }> {
    const guild = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        armoryProfessions: SEED_PROFESSIONS,
    })) as Partial<SeededGuild>;
    const users = guild.users;
    const characterId = users?.['gm']?.characterId;
    if (!users || typeof characterId !== 'string') {
        throw new Error(`[character-detail] seed-guild: ${JSON.stringify(guild)}`);
    }
    const character = (await apiGet(
        token,
        `/characters/${characterId}`,
    )) as SeedCharacter | null;
    if (!character || !character.class || !character.level) {
        throw new Error(
            `[character-detail] seeded character lacks class/level: ${JSON.stringify(character)}`,
        );
    }
    return { guild: { users }, character };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

test.describe('Character detail page', () => {
    let seeded: { guild: SeededGuild; character: SeedCharacter } | null =
        null;

    test.beforeAll(async ({}, testInfo) => {
        seeded = await seedCharacter(await getAdminToken(), testInfo);
    });

    // Removes only the seeded users. The seeded guild, roster, raids and editor
    // grant stay behind on purpose: the next reset-to-seed clears them.
    test.afterAll(async () => {
        if (seeded) await removeUsers(await getAdminToken(), seeded.guild);
    });

    /** The seeded character; fails the test (never skips) when absent. */
    function seededCharacter(): SeedCharacter {
        return defined(seeded?.character, 'seeded character');
    }

    test('renders character name and metadata', async ({ page }) => {
        const character = seededCharacter();
        await page.goto(`/characters/${character.id}`);

        // Character name appears as h1 heading
        await expect(
            page.getByRole('heading', { name: character.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // Class and race visible in the meta line (use .first() since spec/class
        // text may also appear in the talents section further down the page)
        if (character.class) {
            await expect(
                page.getByText(character.class, { exact: true }).first(),
            ).toBeVisible({ timeout: 5_000 });
        }
        if (character.race) {
            await expect(
                page.getByText(character.race, { exact: true }).first(),
            ).toBeVisible({ timeout: 5_000 });
        }
        if (character.spec) {
            await expect(
                page.getByText(character.spec, { exact: true }).first(),
            ).toBeVisible({ timeout: 5_000 });
        }
    });

    test('displays level (item level only when the character has one)', async ({ page }) => {
        const character = seededCharacter();
        await page.goto(`/characters/${character.id}`);

        // Wait for the page to load
        await expect(
            page.getByRole('heading', { name: character.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // ROK-2140: below 640px the header is the Option B profile card, where
        // level and item level are stat tiles (value over label), not inline text.
        const isPhone = (page.viewportSize()?.width ?? 1280) < 640;
        const statTile = (label: string) =>
            page
                .getByTestId('character-stat-tile')
                .filter({ has: page.getByText(label, { exact: true }) });
        if (isPhone) {
            if (character.level) {
                await expect(statTile('Level')).toContainText(
                    String(character.level),
                    { timeout: 5_000 },
                );
            }
            if (character.itemLevel) {
                await expect(statTile('Item Level')).toContainText(
                    String(character.itemLevel),
                    { timeout: 5_000 },
                );
            }
            return;
        }

        // Desktop: level is displayed as "Level N"
        if (character.level) {
            await expect(
                page.getByText(`Level ${character.level}`),
            ).toBeVisible({ timeout: 5_000 });
        }

        // Item level is displayed as "Item Level" followed by the number
        if (character.itemLevel) {
            await expect(page.getByText('Item Level')).toBeVisible({
                timeout: 5_000,
            });
            await expect(
                page.getByText(String(character.itemLevel)),
            ).toBeVisible({ timeout: 5_000 });
        }
    });

    test('renders equipment and talents sections', async ({ page }) => {
        const character = seededCharacter();
        await page.goto(`/characters/${character.id}`);

        // Wait for page load
        await expect(
            page.getByRole('heading', { name: character.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // Equipment section heading
        await expect(
            page.getByRole('heading', { name: 'Equipment' }),
        ).toBeVisible({ timeout: 10_000 });

        // Talents section heading
        await expect(
            page.getByRole('heading', { name: 'Talents' }),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('back button is visible', async ({ page }) => {
        const character = seededCharacter();
        await page.goto(`/characters/${character.id}`);

        await expect(
            page.getByRole('heading', { name: character.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // The back button contains "Back" text
        await expect(
            page.getByRole('button', { name: 'Back', exact: true }),
        ).toBeVisible({ timeout: 5_000 });
    });

    /**
     * ROK-1130 (AC #13) — Professions panel renders when a synced WoW
     * character has a non-null `professions` blob (seeded, ROK-2112). Runs on both desktop
     * and mobile projects (inherits from playwright.config.ts).
     */
    test('renders professions panel for a synced WoW character', async ({
        page,
    }) => {
        const char = seededCharacter();
        await page.goto(`/characters/${char.id}`);

        // Heading
        await expect(
            page.getByRole('heading', {
                name: char.name,
                level: 1,
            }),
        ).toBeVisible({ timeout: 15_000 });

        // Professions panel heading
        await expect(
            page.getByRole('heading', { name: 'Professions' }),
        ).toBeVisible({ timeout: 10_000 });

        // ROK-2107 (AC8) — the source pill names where the shown professions
        // came from. The seed writes `armory_professions` on a synced row, so
        // the DTO reports `blizzard` and the panel shows the "Armory" pill.
        expect(
            char.professionsSource,
            'seeded armoryProfessions must surface as a blizzard source',
        ).toBe('blizzard');
        const region = page.getByRole('region', { name: 'Professions' });
        await expect(region.getByText('Armory', { exact: true })).toBeVisible({
            timeout: 5_000,
        });

        // First primary profession name + its skill text render
        const firstPrimary = defined(
            char.professions?.primary[0],
            'first primary profession',
        );
        await expect(
            page.getByText(firstPrimary.name, { exact: true }).first(),
        ).toBeVisible({ timeout: 5_000 });
        await expect(
            page
                .getByText(
                    `${firstPrimary.skillLevel}/${firstPrimary.maxSkillLevel}`,
                )
                .first(),
        ).toBeVisible({ timeout: 5_000 });
    });
});
