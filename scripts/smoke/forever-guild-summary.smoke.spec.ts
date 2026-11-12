/**
 * ROK-1170 — the WoW: Forever guild summary on the hub page: the "Founded
 * <Mon YYYY>" hero pill and the disbanded-guild warning banner (`heroBanner`,
 * testid `wow-guild-state-banner`).
 *
 * T1 — a guild seeded with `foundedAt` shows "Founded <Mon YYYY>" in the hero
 *      (label and full-date `title` computed in the browser exactly as
 *      `WowFoundedPill` does, so the viewer's locale/time zone never skew it);
 *      a healthy (`ok`) guild shows no banner.
 * T2 — a `disbanded` guild shows the banner to a plain member, with no
 *      "Update the guild path" action; the page is a 200, not an error page,
 *      and the Members roster still renders under the banner.
 * T3 — an editor with settings access (the admin) also sees "Update the guild
 *      path", which opens the hub settings sheet.
 *
 * Fixture: `POST /admin/test/wow/seed-guild` (ROK-1785; Forever by default)
 * with the ROK-1170 `foundedAt` / `blizzardSummaryStatus` overrides and a
 * per-project, per-worker, per-run name. Members sign in as their own fresh
 * session (`signInOnboardedMember`); the seeded users are deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInAsAdmin, signInOnboardedMember } from './browser-session';

const FOUNDED = '2019-03-15T12:00:00.000Z';
const BANNER_COPY = 'Blizzard no longer finds this guild — it may have been disbanded or renamed in game';
const UPDATE_PATH = 'Update the guild path';

type Role = 'gm' | 'officer' | 'member' | 'outsider';
type SummaryStatus = 'ok' | 'not_found' | 'disbanded' | 'error';
interface SeededGuild {
    guildId: number;
    users: Record<Role, { userId: number }>;
}

function guildName(testInfo: TestInfo, tag: string): string {
    return `Summary ${tag} ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo, tag: string, status: SummaryStatus): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo, tag),
        foundedAt: FOUNDED,
        blizzardSummaryStatus: status,
    })) as Partial<SeededGuild> | null;
    if (typeof body?.guildId !== 'number' || !body.users) {
        throw new Error(`[forever-guild-summary] seed-guild: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

async function removeUsers(token: string, guild: SeededGuild | null): Promise<void> {
    if (!guild) return;
    for (const user of Object.values(guild.users)) {
        await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
    }
}

/** Opens the hub, asserting the page fetch is a 200 and the hero renders (never an error page). */
async function openHub(page: Page, guildId: number): Promise<Locator> {
    const pageFetch = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new RegExp(`/guilds/${guildId}$`).test(new URL(r.url()).pathname),
        { timeout: 20_000 },
    );
    await page.goto(`/hubs/${guildId}`);
    expect((await pageFetch).status(), `GET guild page ${guildId}`).toBe(200);
    const hero = page.getByTestId('guild-hero');
    await expect(hero, 'the hub page renders its hero').toBeVisible({ timeout: 20_000 });
    return hero;
}

const banner = (page: Page): Locator => page.getByTestId('wow-guild-state-banner');

test.describe('WoW: Forever guild summary — Founded pill + disbanded banner (ROK-1170)', () => {
    test('T1: a founded guild shows "Founded <Mon YYYY>" in the hero; a healthy guild has no banner', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        let guild: SeededGuild | null = null;
        try {
            guild = await seedGuild(token, testInfo, 'Founded', 'ok');
            await signInOnboardedMember(page, guild.users.member.userId);
            const hero = await openHub(page, guild.guildId);
            const [label, full] = await page.evaluate((iso) => {
                const at = new Date(iso);
                return [
                    at.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }),
                    at.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
                ];
            }, FOUNDED);
            const pill = hero.getByText(`Founded ${label}`, { exact: true });
            await expect(pill, `AC1: the hero shows "Founded ${label}"`).toBeVisible({ timeout: 15_000 });
            await expect(pill, 'AC1: the full founded date sits in the title').toHaveAttribute('title', full);
            await expect(banner(page), 'a healthy (ok) guild shows no disbanded banner').toHaveCount(0);
        } finally {
            await removeUsers(token, guild);
        }
    });

    test('T2: a disbanded guild shows the banner to a member, without the action, and the roster still renders', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        let guild: SeededGuild | null = null;
        try {
            guild = await seedGuild(token, testInfo, 'Gone', 'disbanded');
            await signInOnboardedMember(page, guild.users.member.userId);
            await openHub(page, guild.guildId);
            await expect(banner(page), 'AC5: a member sees the disbanded banner').toBeVisible({ timeout: 15_000 });
            await expect(banner(page)).toContainText(BANNER_COPY);
            await expect(banner(page).getByRole('button', { name: UPDATE_PATH }), 'AC5: a plain member gets no "Update the guild path"').toHaveCount(0);
            await expect(page.getByTestId('guild-overview'), 'the Overview still renders').toBeVisible();
            await page.goto(`/hubs/${guild.guildId}#members`);
            await expect(page.getByTestId('guild-members'), 'AC5: the roster still renders').toBeVisible({ timeout: 15_000 });
            await expect(page.getByTestId('guild-rank-0'), 'the seeded roster rows are listed').toBeVisible();
            await expect(banner(page), 'the banner sits under the hero on every tab').toBeVisible();
        } finally {
            await removeUsers(token, guild);
        }
    });

    test('T3: an editor with settings access sees "Update the guild path", which opens hub settings', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        let guild: SeededGuild | null = null;
        try {
            guild = await seedGuild(token, testInfo, 'Path', 'disbanded');
            await signInAsAdmin(page.context());
            await openHub(page, guild.guildId);
            await expect(banner(page), 'AC5: the editor sees the disbanded banner').toBeVisible({ timeout: 15_000 });
            const action = banner(page).getByRole('button', { name: UPDATE_PATH, exact: true });
            await expect(action, 'AC5: the editor gets "Update the guild path"').toBeVisible();
            await action.click();
            await expect(page.getByTestId('guild-settings-sheet'), 'the action opens the hub settings sheet').toBeVisible({ timeout: 15_000 });
        } finally {
            await removeUsers(token, guild);
        }
    });
});
