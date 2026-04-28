/**
 * Character detail page smoke tests — header info, metadata badges, sections.
 *
 * ROK-905: Verify the character detail page renders correctly at both
 * desktop and mobile viewports.  Uses the same API-driven character
 * lookup pattern as characters.smoke.spec.ts.
 */
import { test, expect } from './base';
import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const STORAGE_STATE_PATH = path.resolve(__dirname, '../.auth/admin.json');

/** Read the JWT token from the saved Playwright storageState file. */
function getTokenFromStorageState(): string | null {
    try {
        const state = JSON.parse(fs.readFileSync(STORAGE_STATE_PATH, 'utf-8'));
        const origin = state.origins?.find((o: { origin: string }) =>
            o.origin.includes('localhost'),
        );
        const entry = origin?.localStorage?.find(
            (e: { name: string }) => e.name === 'raid_ledger_token',
        );
        return entry?.value ?? null;
    } catch {
        return null;
    }
}

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
}

/**
 * Find a seeded character with class/race/level data via the API.
 * Returns the first character that has non-null metadata fields.
 */
async function findCharacterWithMetadata(
    token: string,
): Promise<SeedCharacter | null> {
    const res = await fetch(`${API_BASE}/users/me/characters`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const { data } = (await res.json()) as {
        data: Array<SeedCharacter>;
    };

    return data.find((c) => c.class && c.level) ?? null;
}

/**
 * ROK-1130 — find a seeded WoW character whose `professions` JSONB is
 * populated (non-null + has at least one primary). Used by the
 * professions-panel smoke test below.
 */
async function findCharacterWithProfessions(
    token: string,
): Promise<SeedCharacter | null> {
    const res = await fetch(`${API_BASE}/users/me/characters`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;

    const { data } = (await res.json()) as {
        data: Array<SeedCharacter>;
    };

    return (
        data.find(
            (c) =>
                c.professions != null &&
                c.professions.primary &&
                c.professions.primary.length > 0,
        ) ?? null
    );
}

test.describe('Character detail page', () => {
    let character: SeedCharacter | null = null;

    test.beforeAll(async () => {
        const token = getTokenFromStorageState();
        if (token) {
            character = await findCharacterWithMetadata(token);
        }
    });

    test('renders character name and metadata', async ({ page }) => {
        test.skip(!character, 'No character with metadata in seed data');

        await page.goto(`/characters/${character!.id}`);

        // Character name appears as h1 heading
        await expect(
            page.getByRole('heading', { name: character!.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // Class and race visible in the meta line (use .first() since spec/class
        // text may also appear in the talents section further down the page)
        if (character!.class) {
            await expect(
                page.getByText(character!.class, { exact: true }).first(),
            ).toBeVisible({ timeout: 5_000 });
        }
        if (character!.race) {
            await expect(
                page.getByText(character!.race, { exact: true }).first(),
            ).toBeVisible({ timeout: 5_000 });
        }
        if (character!.spec) {
            await expect(
                page.getByText(character!.spec, { exact: true }).first(),
            ).toBeVisible({ timeout: 5_000 });
        }
    });

    test('displays level and item level', async ({ page }) => {
        test.skip(!character, 'No character with metadata in seed data');

        await page.goto(`/characters/${character!.id}`);

        // Wait for the page to load
        await expect(
            page.getByRole('heading', { name: character!.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // Level is displayed as "Level N"
        if (character!.level) {
            await expect(
                page.getByText(`Level ${character!.level}`),
            ).toBeVisible({ timeout: 5_000 });
        }

        // Item level is displayed as "Item Level" followed by the number
        if (character!.itemLevel) {
            await expect(page.getByText('Item Level')).toBeVisible({
                timeout: 5_000,
            });
            await expect(
                page.getByText(String(character!.itemLevel)),
            ).toBeVisible({ timeout: 5_000 });
        }
    });

    test('renders equipment and talents sections', async ({ page }) => {
        test.skip(!character, 'No character with metadata in seed data');

        await page.goto(`/characters/${character!.id}`);

        // Wait for page load
        await expect(
            page.getByRole('heading', { name: character!.name, level: 1 }),
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
        test.skip(!character, 'No character with metadata in seed data');

        await page.goto(`/characters/${character!.id}`);

        await expect(
            page.getByRole('heading', { name: character!.name, level: 1 }),
        ).toBeVisible({ timeout: 15_000 });

        // The back button contains "Back" text
        await expect(
            page.getByRole('button', { name: 'Back', exact: true }),
        ).toBeVisible({ timeout: 5_000 });
    });

    /**
     * ROK-1130 (AC #13) — Professions panel renders when a synced WoW
     * character has a non-null `professions` blob. Runs on both desktop
     * and mobile projects (inherits from playwright.config.ts).
     */
    test('renders professions panel for a synced WoW character', async ({
        page,
    }) => {
        const token = getTokenFromStorageState();
        test.skip(!token, 'No admin token in storage state');

        const profChar = await findCharacterWithProfessions(token!);
        test.skip(
            !profChar,
            'No seeded WoW character with non-null professions',
        );

        await page.goto(`/characters/${profChar!.id}`);

        // Heading
        await expect(
            page.getByRole('heading', {
                name: profChar!.name,
                level: 1,
            }),
        ).toBeVisible({ timeout: 15_000 });

        // Professions panel heading
        await expect(
            page.getByRole('heading', { name: 'Professions' }),
        ).toBeVisible({ timeout: 10_000 });

        // First primary profession name + its skill text render
        const firstPrimary = profChar!.professions!.primary[0];
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
