/**
 * Guild page smoke (ROK-1785, S1 of ROK-1781) — desktop, tablet AND mobile.
 *
 * Every test seeds its OWN guild through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` (a per-project, per-worker, per-run name),
 * so the parallel projects never share a guild or a viewer. The cast: a GM
 * (rank 0), a delegated officer (rank 1, rank-editor grant), a plain member
 * (rank 3), two unlinked roster rows (ranks 2, 4) and an outsider with no
 * character. Each viewer is a fresh member signed in with its own session —
 * the shared admin's session and preferences are never touched. The seeded
 * users are deleted in `finally`; the guild row stays (disposable env).
 *
 * Entry points: the header Guild link renders from 768px (Header `md:`), the
 * More drawer's "Your guild" block below it — chosen by the live viewport.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededUser {
    userId: number;
    characterId: string | null;
}

interface SeededGuild {
    guildId: number;
    users: Record<Role, SeededUser>;
}

const HEADER_NAV_MIN_WIDTH = 768;

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Smoke ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
    })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) {
        throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

async function removeUsers(token: string, guild: SeededGuild): Promise<void> {
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** Seed a guild, run `body`, and always delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (guild: SeededGuild) => Promise<void>) {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        await body(guild);
    } finally {
        await removeUsers(token, guild);
    }
}

async function openGuildAs(page: Page, guild: SeededGuild, role: Role, hash = ''): Promise<void> {
    await signInOnboardedMember(page, guild.users[role].userId);
    await page.goto(`/guilds/${guild.guildId}${hash}`);
}

test('GM: hero, rank-grouped roster, character link, Page editors card', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'gm');
        await expect(page.getByTestId('guild-hero')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-editors-panel'), 'the GM manages page editors').toBeVisible();
        await page.goto(`/guilds/${guild.guildId}#roster`);
        await expect(page.getByTestId('guild-roster')).toBeVisible({ timeout: 15_000 });
        for (const rank of [0, 1, 2, 3, 4]) {
            await expect(page.getByTestId(`guild-rank-${rank}`)).toBeVisible();
        }
        const link = page.getByTestId('guild-member-link').filter({ hasText: 'Aldren' });
        await expect(link).toHaveAttribute('href', `/characters/${guild.users.gm.characterId ?? 'missing'}`);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/characters/${guild.users.gm.characterId ?? 'missing'}$`));
    });
});

test('#roster deep-links straight to the Roster tab', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'gm', '#roster');
        const tabs = page.getByRole('navigation', { name: 'Guild page sections' });
        await expect(tabs.locator('a[href="#roster"]')).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
        await expect(page.getByTestId('guild-roster')).toBeVisible();
    });
});

test('plain member: the page renders without the Page editors card', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member');
        await expect(page.getByTestId('guild-hero')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-overview')).toBeVisible();
        await expect(page.getByTestId('guild-editors-panel'), 'a plain member cannot manage editors').toHaveCount(0);
    });
});

test('non-member: the "not a member" state, no hero', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'outsider');
        await expect(page.getByTestId('guild-not-member')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-hero')).toHaveCount(0);
    });
});

test('entry points: header link / drawer "Your guild" reach the page; Players card', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await signInOnboardedMember(page, guild.users.member.userId);
        await page.goto('/players');
        const card = page.getByTestId('players-guild-card');
        await expect(card, 'the member sees their guild on Players').toBeVisible({ timeout: 15_000 });
        await expect(card.getByTestId('players-guild-open')).toHaveAttribute('href', `/guilds/${guild.guildId}`);
        const width = page.viewportSize()?.width ?? 0;
        if (width >= HEADER_NAV_MIN_WIDTH) {
            await page.getByTestId('nav-guild-link').click();
        } else {
            await page.getByRole('button', { name: 'Open menu' }).click();
            const block = page.getByTestId('more-drawer-panel').getByTestId('drawer-your-guild');
            await expect(block).toBeVisible();
            await block.getByTestId('guild-entry-row').click();
        }
        await expect(page).toHaveURL(new RegExp(`/guilds/${guild.guildId}(?:[?#]|$)`));
        await expect(page.getByTestId('guild-hero')).toBeVisible({ timeout: 15_000 });
    });
});
