/**
 * Guild Members — filters, sort and the flat/grouped switch (ROK-1173) —
 * desktop AND mobile projects.
 *
 * Seeds its OWN guild through the DEMO_MODE fixture `POST /admin/test/wow/seed-guild`
 * (per-project, per-worker, per-run name). The seed roster is five Level 60
 * Warriors — Aldren (GM, rank 0, linked), Brisa (officer, 1, linked), Corvin (2,
 * unlinked), Dainel (member, 3, linked), Elowen (4, unlinked) — so the class /
 * level filters do not narrow on their own (the step only proves they compose
 * with a filter that does); the "Linked to an RL account only" switch narrows
 * 5 → 3. Rank, name and level order all coincide on that seed, so the sort
 * step uses Name Z–A — the one order that differs from rank order. Seeded
 * users are deleted in `finally`.
 *
 * Filters open from the inline funnel at 1024px and up, from the Filters FAB +
 * BottomSheet below (the funnel standard, design-system §4.1); the opener /
 * surface locators are the shared ones in `games-filters.ts`.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { filtersOpener, filtersSurface, hasFilterFunnel } from './games-filters';

interface SeededGuild {
    guildId: number;
    users: Record<string, { userId: number }>;
}

const RANK_BANDS = ['0', '1', '2', '3', '4'] as const;

function guildName(testInfo: TestInfo): string {
    return `Smoke filt ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`.slice(0, 48);
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', { name: guildName(testInfo) })) as Partial<SeededGuild>;
    if (typeof body.guildId !== 'number' || !body.users) throw new Error(`seed-guild: ${JSON.stringify(body)}`);
    return { guildId: body.guildId, users: body.users };
}

/**
 * Funnel trigger at ≥1024px, Filters FAB below; both toggle the same FilterEntry.
 * Neither closed surface unmounts — the collapsed inline panel and the closed
 * sheet body stay mounted `inert` + `aria-hidden` — so open/closed is read from
 * the opener's `aria-expanded` and the surface's `aria-hidden`, never from
 * whether a control inside it is mounted or "visible" (opacity-0 still counts).
 */
async function openFilters(page: Page): Promise<void> {
    const opener = filtersOpener(page);
    await expect(opener).toBeVisible();
    if ((await opener.getAttribute('aria-expanded')) !== 'true') await opener.click();
    await expect(opener, 'the Filters opener reports the entry open').toHaveAttribute('aria-expanded', 'true');
    const surface = filtersSurface(page);
    await expect(surface).toBeVisible();
    await expect(surface, 'the open filter surface is in the a11y tree').not.toHaveAttribute('aria-hidden', 'true');
    await expect(surface.getByTestId('wow-filter-class')).toBeVisible();
}

/** Desktop collapses the inline panel from the funnel; the phone sheet closes from its Close button. */
async function closeFilters(page: Page): Promise<void> {
    const opener = filtersOpener(page);
    if (hasFilterFunnel(page)) {
        await opener.click();
        await expect(page.getByTestId('filter-panel'), 'the collapsed inline panel leaves the a11y tree').toHaveAttribute('aria-hidden', 'true');
    } else {
        await page.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Close' }).click();
        await expect(page.getByRole('dialog', { name: 'Filters' }), 'the Filters sheet is closed').toBeHidden();
    }
    await expect(opener, 'the Filters opener reports the entry closed').toHaveAttribute('aria-expanded', 'false');
}

function memberRow(page: Page, index: number) {
    return page.getByTestId('guild-member-row').nth(index);
}

test('Members: filter narrows the count, Name Z–A reorders flat rows, Clear all + Rank restores the bands', async ({ page }, testInfo) => {
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
        await expect(page.getByTestId('guild-members-count'), 'the linked switch narrows 5 → 3; Warrior and Min level 60 match every seeded member, so they only prove the groups AND together')
            .toHaveText('3 of 5 members');
        await expect(page.getByTestId('guild-rank-0'), 'an active filter flattens the list (D5)').toHaveCount(0);

        await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Name Z–A' });
        await expect(memberRow(page, 0), 'Name Z–A puts Dainel first (rank order would put Aldren first)').toContainText('Dainel');
        await expect(memberRow(page, 1), 'Name Z–A: Brisa second').toContainText('Brisa');
        await expect(memberRow(page, 2), 'Name Z–A: Aldren last').toContainText('Aldren');

        await openFilters(page);
        await filtersSurface(page).getByRole('button', { name: 'Clear all' }).click();
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
