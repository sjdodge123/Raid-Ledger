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
 *
 * ROK-2281: a second case gives the three linked members Mining through the
 * ordinary `PATCH /users/me/characters/:id`, each as themselves with an access
 * token minted over plain API requests (no browser sign-ins), BEFORE anything
 * reads roster insights (the endpoint caches per guild + audience for 5
 * minutes); the browser then signs in ONCE, as the GM. Picking the Mining
 * pill adds "Mining high→low" / "Mining low→high" to Sort by; the step reads
 * each row's Mining skill from its profession badge and checks the order, then
 * unpicks the pill and expects the sort back on Rank.
 */
import { request, type Page, type TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiGet, apiPatch, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInContextAs, signInOnboardedMember } from './browser-session';
import { filtersOpener, filtersSurface, hasFilterFunnel } from './games-filters';
import { resolveApiUrl } from './target';

interface SeededGuild {
    guildId: number;
    users: Record<string, { userId: number; characterId?: string | null }>;
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

const PROFESSION = 'Mining';
/** Linked seed members → the Mining skill each records (the browser views the list as the GM). */
const MINING_SKILLS = [['officer', 275], ['member', 120], ['gm', 200]] as const;

/** One linked member records Mining on their own character (a manual professions fact). */
async function setMining(jwt: string, characterId: string, skillLevel: number): Promise<void> {
    const professions = {
        primary: [{ id: 186, name: PROFESSION, slug: 'mining', skillLevel, maxSkillLevel: 300, tiers: [] }],
        secondary: [],
        syncedAt: new Date().toISOString(),
    };
    const res = (await apiPatch(jwt, `/users/me/characters/${characterId}`, { professions })) as { professions?: unknown; message?: unknown };
    expect(res.professions, `the Mining PATCH should save: ${JSON.stringify(res.message ?? res)}`).toBeTruthy();
}

/**
 * A seeded member's access JWT without a browser: a fresh refresh family
 * (`/admin/test/browser-session`) in a throwaway API request context's cookie
 * jar, rotated once by `POST /auth/refresh` (no Origin → the same-origin guard
 * allows a non-browser client).
 */
async function memberAccessToken(adminToken: string, userId: number): Promise<string> {
    const apiUrl = resolveApiUrl();
    const api = await request.newContext();
    try {
        const session = await api.post(`${apiUrl}/admin/test/browser-session`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { userId } });
        if (session.status() !== 204) throw new Error(`browser-session {userId:${userId}} → ${session.status()}: ${await session.text()}`);
        const refresh = await api.post(`${apiUrl}/auth/refresh`);
        const jwt = ((await refresh.json().catch(() => null)) as { access_token?: unknown } | null)?.access_token;
        if (refresh.status() !== 200 || typeof jwt !== 'string') throw new Error(`POST /auth/refresh for user ${userId} → ${refresh.status()} without an access_token`);
        return jwt;
    } finally {
        await api.dispose();
    }
}

/** Every linked member records Mining over the API; returns the GM's JWT. */
async function seedMining(adminToken: string, guild: SeededGuild): Promise<string> {
    let gmJwt = '';
    for (const [role, skill] of MINING_SKILLS) {
        const user = guild.users[role];
        if (!user?.characterId) throw new Error(`seed-guild: the ${role} should own a linked character`);
        const jwt = await memberAccessToken(adminToken, user.userId);
        await setMining(jwt, user.characterId, skill);
        if (role === 'gm') gmJwt = jwt;
    }
    return gmJwt;
}

/**
 * Sign the browser in once, as the GM. Onboarding is finished over the API first,
 * so no boot ever caches the not-onboarded user and AuthGuard never detours to
 * the `/onboarding` wizard.
 */
async function signInAsGm(page: Page, gmJwt: string, gmUserId: number): Promise<void> {
    const done = await page.context().request.post(`${resolveApiUrl()}/users/me/complete-onboarding`, { headers: { Authorization: `Bearer ${gmJwt}` } });
    expect(done.ok(), `complete-onboarding for the GM → ${done.status()}`).toBe(true);
    await signInContextAs(page.context(), gmUserId);
}

async function waitForMining(gmJwt: string, guildId: number): Promise<void> {
    type Insights = { professions?: { name: string; members: unknown[] }[] } | null;
    await pollForCondition(
        async () => {
            const data = (await apiGet(gmJwt, `/plugins/wow/guilds/${guildId}/roster-insights`)) as Insights;
            const mining = data?.professions?.find((p) => p.name === PROFESSION);
            return (mining?.members.length ?? 0) >= MINING_SKILLS.length ? true : null;
        },
        { timeoutMs: 15_000, description: `roster-insights for guild ${guildId} lists ${MINING_SKILLS.length} miners` },
    );
}

/** The Mining skill on each listed row, top to bottom (from the badge title "Mining 275/300"). */
async function listedMiningSkills(page: Page): Promise<number[]> {
    const titles = await page.getByTestId('guild-member-row').getByTestId('guild-member-professions')
        .locator(`[title^="${PROFESSION} "]`).evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''));
    return titles.map((t) => Number(/ (\d+)\//.exec(t)?.[1] ?? Number.NaN));
}

async function expectMiningOrder(page: Page, label: string, direction: 'desc' | 'asc'): Promise<void> {
    await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label });
    const want = MINING_SKILLS.map(([, skill]) => skill).sort((a, b) => (direction === 'desc' ? b - a : a - b));
    await expect.poll(() => listedMiningSkills(page), { message: `${label} orders the rows by Mining skill` }).toEqual(want);
}

test('Members: a picked profession pill adds high→low / low→high sorts by that skill (ROK-2281)', async ({ page }, testInfo) => {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        const gmJwt = await seedMining(token, guild);
        await waitForMining(gmJwt, guild.guildId);
        const gm = guild.users['gm'];
        if (!gm) throw new Error('seed-guild: no gm user');
        await signInAsGm(page, gmJwt, gm.userId);
        await page.goto(`/hubs/${guild.guildId}#members`);
        await expect(page.getByTestId('guild-members')).toBeVisible({ timeout: 15_000 });
        const sort = page.getByRole('combobox', { name: 'Sort by' });
        await expect(sort.getByRole('option', { name: `${PROFESSION} high→low` }), 'no pill picked → no profession sorts').toHaveCount(0);

        const chip = page.getByTestId(`wow-profession-chip-${PROFESSION}`);
        await chip.click();
        await expect(page.getByTestId('guild-members-count'), 'the Mining pill keeps the three miners').toHaveText('3 of 5 members');
        await expect(sort, 'picking a pill does not change the sort').toHaveValue('rank');
        await expectMiningOrder(page, `${PROFESSION} high→low`, 'desc');
        await expectMiningOrder(page, `${PROFESSION} low→high`, 'asc');

        await chip.click();
        await expect(sort, 'unpicking the pill whose sort is active falls back to Rank').toHaveValue('rank');
        await expect(sort.getByRole('option', { name: `${PROFESSION} low→high` })).toHaveCount(0);
        await expect(page.getByTestId('guild-members-count')).toHaveText('5 members');
    } finally {
        for (const user of Object.values(guild.users)) await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
});
