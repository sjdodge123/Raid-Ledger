/**
 * Guild Members — filters, sort and the flat/grouped switch (ROK-1173) —
 * desktop AND mobile projects.
 *
 * Seeds its OWN guild through the DEMO_MODE fixture `POST /admin/test/wow/seed-guild`
 * (per-project, per-worker, per-run name). The seed roster is five Level 60
 * Warriors — Aldren (GM, rank 0, linked), Brisa (officer, 1, linked), Corvin (2,
 * unlinked), Dainel (member, 3, linked), Elowen (4, unlinked) — so the class /
 * level filters do not narrow on their own; the "Linked to an RL account only"
 * switch does (3 of 5). Level sort ties are broken by name (AC4), which the
 * sort step pins. Seeded users are deleted in `finally`.
 *
 * Filters open from the inline funnel at 1024px and up, from the Filters FAB +
 * BottomSheet below (the funnel standard, design-system §4.1).
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';

interface SeededGuild {
    guildId: number;
    users: Record<string, { userId: number }>;
}

const DESKTOP_MIN_WIDTH = 1024;
const RANK_BANDS = ['0', '1', '2', '3', '4'] as const;

function guildName(testInfo: TestInfo): string {
    return `Smoke filt ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`.slice(0, 48);
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

function isDesktop(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= DESKTOP_MIN_WIDTH;
}

/** Funnel trigger at ≥1024px, Filters FAB below; both toggle the same FilterEntry. */
async function openFilters(page: Page): Promise<void> {
    await page.getByTestId(isDesktop(page) ? 'filter-panel-trigger' : 'filter-fab').click();
    await expect(page.getByTestId('wow-filter-class')).toBeVisible();
}

/** The phone BottomSheet covers the toolbar; the desktop panel is inline and stays. */
async function closeFilters(page: Page): Promise<void> {
    if (isDesktop(page)) return;
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('wow-filter-class')).toHaveCount(0);
}

function memberRow(page: Page, index: number) {
    return page.getByTestId('guild-member-row').nth(index);
}

test('Members: filter narrows the count, Level sort orders flat rows, Clear all + Rank restores the bands', async ({ page }, testInfo) => {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        const gm = guild.users['gm'];
        if (!gm) throw new Error('seed-guild returned no gm user');
        await signInOnboardedMember(page, gm.userId);
        await page.goto(`/hubs/${guild.guildId}#members`);
        const members = page.getByTestId('guild-members');
        await expect(members).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-members-count')).toHaveText('5 members');
        for (const rank of RANK_BANDS) await expect(page.getByTestId(`guild-rank-${rank}`)).toBeVisible();
        await expect(page.getByTestId('guild-member-row').filter({ hasText: 'Aldren' }).getByTestId('guild-member-you'),
            'AC9: the GM sees "You" on their own row').toBeVisible();

        await openFilters(page);
        await page.getByTestId('wow-filter-class').getByRole('button', { name: 'Warrior' }).click();
        await page.getByLabel('Min level').fill('60');
        await page.getByTestId('wow-filter-linked').click();
        await closeFilters(page);
        await expect(page.getByTestId('guild-members-count'), 'Warrior + Lv ≥60 + linked only = the three linked members')
            .toHaveText('3 of 5 members');
        await expect(page.getByTestId('guild-rank-0'), 'an active filter flattens the list (D5)').toHaveCount(0);

        await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Level high→low' });
        await expect(memberRow(page, 0), 'every seeded member is Lv 60, so the name tie-break orders them').toContainText('Aldren');
        await expect(memberRow(page, 1)).toContainText('Brisa');
        await expect(memberRow(page, 2)).toContainText('Dainel');

        await openFilters(page);
        await page.getByRole('button', { name: 'Clear all' }).click();
        await closeFilters(page);
        await expect(page.getByTestId('guild-members-count'), 'Clear all resets filters only').toHaveText('5 members');
        await expect(page.getByTestId('guild-rank-0'), 'a non-default sort keeps the list flat').toHaveCount(0);

        await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Rank' });
        for (const rank of RANK_BANDS) await expect(page.getByTestId(`guild-rank-${rank}`), `rank band ${rank} is back`).toBeVisible();
        await expect(memberRow(page, 0)).toContainText('Aldren');
    } finally {
        for (const user of Object.values(guild.users)) await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
});
