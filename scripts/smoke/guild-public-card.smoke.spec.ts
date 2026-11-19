/**
 * ROK-1813 — the opt-in public recruiting card (desktop + mobile).
 *
 * Seeds (DEMO_MODE, admin JWT): `POST /admin/test/wow/seed-guild` with a
 * per-project, per-worker, per-run name and `withPublicCard: true` (implies
 * `withRecruitment`: Priest/Warlock open, Druid limited with a note, Rogue
 * closed, https apply URL) → `{guildId, publicCardSlug}`. `finally` deletes
 * the seeded member users (the guild-page / hub-rename pattern).
 *
 * The public page runs in a signed-out context (`{cookies: [], origins: []}`,
 * the gg.smoke pattern). The editor flips the card from the hub's settings
 * sheet as the default (admin) page; every flip is confirmed by polling the
 * editor read before the public page is reloaded (memory
 * `feedback_smoke_polling_for_async_writes`). No `sleep()`.
 */
import type { Browser, Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPost, getAdminToken } from './api-helpers';

interface CardSeed {
    guildId: number;
    slug: string;
    userIds: number[];
}

async function seedCardGuild(token: string, testInfo: TestInfo): Promise<CardSeed> {
    const name = `Card ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now().toString(36)}`;
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name, withPublicCard: true })) as {
        guildId?: unknown;
        publicCardSlug?: unknown;
        users?: Record<string, { userId?: unknown }>;
    } | null;
    if (typeof body?.guildId !== 'number' || typeof body.publicCardSlug !== 'string') {
        throw new Error(`[guild-public-card] seed-guild withPublicCard: ${JSON.stringify(body)}`);
    }
    const userIds = Object.values(body.users ?? {})
        .map((u) => u.userId)
        .filter((id): id is number => typeof id === 'number');
    return { guildId: body.guildId, slug: body.publicCardSlug, userIds };
}

/** The editor read (`{enabled, slug}`) as the admin sees it. */
async function cardEnabled(token: string, guildId: number): Promise<unknown> {
    const body = (await apiGet(token, `/plugins/wow/guilds/${guildId}/public-card`)) as { enabled?: unknown } | null;
    return body?.enabled;
}

async function openSettings(page: Page, guildId: number): Promise<Locator> {
    await page.goto(`/hubs/${guildId}`);
    await page.getByTestId('guild-settings-trigger').click({ timeout: 20_000 });
    const sheet = page.getByTestId('guild-settings-sheet');
    await expect(sheet).toBeVisible();
    return sheet;
}

async function signedOutPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    return { page: await anon.newPage(), close: () => anon.close() };
}

async function expectCard(pub: Page): Promise<void> {
    const card = pub.getByTestId('public-guild-card');
    await expect(card, 'the card renders for a signed-out visitor').toBeVisible({ timeout: 20_000 });
    await expect(pub.getByTestId('public-guild-card-initials'), 'initials stand in for the crest').toBeVisible();
    await expect(pub.getByTestId('public-guild-card-wanted').first(), 'wanted rows come from the recruitment').toBeVisible();
    await expect(card, 'per-row editor notes never reach the public card').not.toContainText('Exceptional only');
    const apply = pub.getByTestId('public-guild-card-apply');
    await expect(apply, 'Apply links to the https apply URL').toHaveAttribute('href', /^https:\/\//);
    await expect(apply).toHaveAttribute('target', '_blank');
    await expect(apply).toHaveAttribute('rel', 'noopener noreferrer');
}

test.describe('guild public recruiting card (ROK-1813)', () => {
    test('signed-out card with noindex; the editor switch turns it off and on again', async ({ page, browser }, testInfo) => {
        const admin = await getAdminToken();
        const seed = await seedCardGuild(admin, testInfo);
        const anon = await signedOutPage(browser);
        try {
            const publicPath = `/p/guild/${seed.slug}`;
            await anon.page.goto(publicPath);
            await expectCard(anon.page);
            await expect(anon.page.locator('meta[name="robots"]'), 'the page asks search engines to stay out')
                .toHaveAttribute('content', 'noindex, nofollow');

            const sheet = await openSettings(page, seed.guildId);
            const section = sheet.getByTestId('wow-public-card-section');
            await expect(section, 'an editor sees the public card section').toBeVisible({ timeout: 20_000 });
            await expect(section.getByTestId('wow-public-card-link'), 'the link is the seeded slug')
                .toHaveValue(new RegExp(`/p/guild/${seed.slug}$`));
            const toggle = section.getByTestId('wow-public-card-toggle');
            await expect(toggle).toHaveAttribute('aria-checked', 'true');

            await toggle.click();
            await expect.poll(() => cardEnabled(admin, seed.guildId), { message: 'switching off must reach the API' }).toBe(false);
            await expect(section.getByTestId('wow-public-card-link'), 'no link while off').toHaveCount(0);
            await anon.page.goto(publicPath);
            await expect(anon.page.getByTestId('public-guild-card-not-found'), 'off reads as not found').toBeVisible({ timeout: 20_000 });
            await expect(anon.page.getByTestId('public-guild-card')).toHaveCount(0);

            await toggle.click();
            await expect.poll(() => cardEnabled(admin, seed.guildId), { message: 'switching on must reach the API' }).toBe(true);
            await expect(section.getByTestId('wow-public-card-link'), 'the slug survives off → on')
                .toHaveValue(new RegExp(`/p/guild/${seed.slug}$`));
            await anon.page.goto(publicPath);
            await expectCard(anon.page);
        } finally {
            await anon.close();
            for (const id of seed.userIds) await apiDelete(admin, `/users/${id}`).catch(() => undefined);
        }
    });
});
