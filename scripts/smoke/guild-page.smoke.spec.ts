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
 * Entry points, chosen by the live viewport: the header "Guild" text link from
 * 1024px (`lg:`), the guild item in the user (avatar) menu at 768–1023px (the
 * header bar there is unchanged from core), and the More drawer's "Your guild"
 * block below 768px.
 */
import type { Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInAsAdmin, signInOnboardedMember } from './browser-session';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededUser {
    userId: number;
    characterId: string | null;
}

interface SeededGuild {
    guildId: number;
    users: Record<Role, SeededUser>;
}

/** Header `lg:` — the "Guild" link shows its text. */
const HEADER_NAV_MIN_WIDTH = 1024;
/** Header `md:` — the user menu shows; below lg it carries the guild item. */
const USER_MENU_MIN_WIDTH = 768;

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

test('GM: hero, rank-grouped members, character link, no Page editors card', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'gm');
        await expect(page.getByTestId('guild-hero')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-overview')).toBeVisible();
        await expect(page.getByTestId('guild-editors-panel'), 'rank 0 confers no editor management (GM_RANK_IMPLIES_EDIT off)').toHaveCount(0);
        await page.goto(`/guilds/${guild.guildId}#members`);
        await expect(page.getByTestId('guild-members')).toBeVisible({ timeout: 15_000 });
        for (const rank of [0, 1, 2, 3, 4]) {
            await expect(page.getByTestId(`guild-rank-${rank}`)).toBeVisible();
        }
        const link = page.getByTestId('guild-member-link').filter({ hasText: 'Aldren' });
        await expect(link).toHaveAttribute('href', `/characters/${guild.users.gm.characterId ?? 'missing'}`);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/characters/${guild.users.gm.characterId ?? 'missing'}$`));
    });
});

test('admin: the settings sheet holds the editors, with the rank-1 grant and the "add your Guild Master" hint', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await signInAsAdmin(page.context());
        await page.goto(`/guilds/${guild.guildId}`);
        const trigger = page.getByTestId('guild-settings-trigger');
        await expect(trigger, 'admins get the single settings entry point (ROK-1830 S4)').toBeVisible({ timeout: 15_000 });
        await trigger.click();
        const panel = page.getByTestId('guild-editors-panel');
        await expect(panel, 'admins manage page editors').toBeVisible();
        await expect(panel.getByTestId('guild-editors-gm-hint')).toHaveText('Add your Guild Master as an editor.');
        await expect(panel.getByTestId('guild-editor-chip')).toHaveCount(1);
        const hide = page.getByTestId('guild-settings-hide-hub');
        await expect(hide, 'no endpoint hides a hub yet (spec Q7 → ROK-1831)').toBeDisabled();
        await expect(hide).toHaveAttribute('aria-checked', 'false');
    });
});

test('officer (rank-1 grant): can edit, but no settings sheet and no editors', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        await expect(page.getByTestId('guild-hero')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-overview')).toBeVisible();
        await expect(page.getByTestId('guild-settings-trigger'), 'the sheet is Leader/admin only (D10/Q4)').toHaveCount(0);
        await expect(page.getByTestId('guild-editors-panel'), 'managing editors is admin/operator-only').toHaveCount(0);
    });
});

test('#members deep-links straight to the Members tab, and the retired #roster still lands there', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'gm', '#members');
        const tabs = page.getByRole('navigation', { name: 'Guild page sections' });
        await expect(tabs.locator('a[href="#members"]')).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
        await expect(page.getByTestId('guild-members')).toBeVisible();

        // ROK-1830 D7-A: links shared before the rename keep working, and the
        // address bar is rewritten so the next copy of the link is current.
        await page.goto(`/guilds/${guild.guildId}#roster`);
        await expect(tabs.locator('a[href="#members"]')).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
        await expect(page.getByTestId('guild-members')).toBeVisible();
        await expect(page).toHaveURL(new RegExp('#members$'));
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

test('entry points: header text link / user menu item / drawer "Your guild" reach the page; Players card', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await signInOnboardedMember(page, guild.users.member.userId);
        await page.goto('/players');
        const card = page.getByTestId('players-guild-card');
        await expect(card, 'the member sees their guild on Players').toBeVisible({ timeout: 15_000 });
        await expect(card.getByTestId('players-guild-open')).toHaveAttribute('href', `/guilds/${guild.guildId}`);
        const width = page.viewportSize()?.width ?? 0;
        const headerLink = page.getByRole('navigation', { name: 'Main navigation' })
            .getByRole('link', { name: 'Guild', exact: true });
        if (width >= HEADER_NAV_MIN_WIDTH) {
            await expect(headerLink, 'the header text link').toHaveAttribute('data-testid', 'nav-guild-link');
            await expect(headerLink, '"Guild" text from 1024px').toBeVisible();
            await headerLink.click();
        } else if (width >= USER_MENU_MIN_WIDTH) {
            await expect(headerLink, 'no guild control in the header bar at 768–1023px').toBeHidden();
            await page.getByTestId('user-menu-trigger').click();
            const item = page.getByTestId('user-menu-guild-item');
            await expect(item, 'the user menu lists the guild at 768–1023px').toBeVisible();
            await item.click();
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

/*
 * ROK-1787 (S3) — the seed-guild fixture also tags a weekly "Molten Core Night"
 * series (3 nights from next week) and a past "Onyxia Clear" with attendance.
 * ROK-1830 S3c split that content: core #events holds schedule + attendance +
 * events, the WoW #raids tab keeps role composition.
 */
test('#events: the core tab carries the schedule, attendance and every tagged event', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member', '#events');
        const tabs = page.getByRole('navigation', { name: 'Guild page sections' });
        await expect(tabs.locator('a[href="#events"]')).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
        const tab = page.getByTestId('guild-events-tab');
        await expect(tab).toBeVisible({ timeout: 15_000 });
        const night = tab.getByTestId('guild-schedule-night');
        await expect(night, 'one row per tagged recurring series').toHaveCount(1);
        await expect(night).toContainText('Molten Core Night');
        await expect(tab.getByText('Shown in your local time')).toBeVisible();
        await expect(tab.getByTestId('guild-attendance-row').first()).toBeVisible();
        await expect(tab.getByTestId('guild-upcoming-event'), 'the three seeded series nights').toHaveCount(3);
        await expect(tab.getByTestId('guild-recent-event').filter({ hasText: 'Onyxia Clear' })).toBeVisible();
        // ROK-1830 S3c: role composition is the WoW module's, on #raids.
        await expect(tab.getByTestId('guild-composition-tank')).toHaveCount(0);
    });
});

test('#raids: the WoW module tab keeps role composition and nothing core already shows', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member', '#raids');
        const tabs = page.getByRole('navigation', { name: 'Guild page sections' });
        await expect(tabs.locator('a[href="#raids"]')).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
        const tab = page.getByTestId('guild-raids-tab');
        await expect(tab).toBeVisible({ timeout: 15_000 });
        await expect(tab.getByTestId('guild-composition-tank')).toBeVisible();
        await expect(tab.getByTestId('guild-schedule-night'), 'the schedule moved to #events').toHaveCount(0);
        await expect(tab.getByTestId('guild-upcoming-event'), 'the event list moved to #events').toHaveCount(0);
        await expect(tab.getByTestId('guild-attendance-row'), 'attendance moved to #events').toHaveCount(0);
    });
});

test('hero "Next raid" chip jumps from Overview to the Raids tab', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'gm');
        await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('guild-overview').getByTestId('guild-schedule-night')).toBeVisible({ timeout: 15_000 });
        const chip = page.getByTestId('guild-next-raid');
        await expect(chip).toHaveAttribute('href', '#raids', { timeout: 15_000 });
        await chip.click();
        await expect(page).toHaveURL(/#raids$/);
        await expect(page.getByTestId('guild-raids-tab'), 'a plain anchor fires hashchange, so the tab switches').toBeVisible({ timeout: 15_000 });
    });
});

test('editor: the Overview setup checklist scores the seeded hub and stays dismissed', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        const list = page.getByTestId('setup-checklist');
        await expect(list, 'the seeded hub still has steps outstanding (ROK-1830 S5b, D11-B)').toBeVisible({ timeout: 15_000 });
        // An Officer has no channel picker, so the Discord row is blocked and
        // drops out of the count: six countable steps, not seven.
        // roster + next-raid + mods are seeded; leader-post, rules and links
        // are profile copy the seed leaves empty — an exact 3, not a wildcard.
        await expect(page.getByTestId('setup-checklist-progress')).toHaveText('3 of 6 done');
        // The seed already satisfies three of them; the profile ones it does not.
        await expect(list.getByTestId('setup-step-roster'), 'the Officer is a seeded member').toHaveAttribute('data-done', 'true');
        await expect(list.getByTestId('setup-step-next-raid'), 'the seed tags raid nights').toHaveAttribute('data-done', 'true');
        await expect(list.getByTestId('setup-step-mods'), 'the seeded WoW hub ships addons').toHaveAttribute('data-done', 'true');
        await expect(list.getByTestId('setup-step-leader-post')).toHaveAttribute('data-done', 'false');
        await expect(list.getByTestId('setup-step-action-rules')).toHaveAttribute('href', '#resources');
        await expect(list.getByTestId('setup-step-blocked-discord'), 'an Officer is told to ask the Leader (ruling 1)').toBeVisible();
        await expect(page.getByTestId('setup-step-blocked-publish'), 'hiding a hub lands in ROK-1831').toBeVisible();

        await page.getByTestId('setup-checklist-dismiss').click();
        await expect(page.getByTestId('setup-checklist')).toHaveCount(0);
        // Server-side per hub: a reload must not bring it back.
        await page.reload();
        await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('setup-checklist'), 'the dismissal is stored, not local state').toHaveCount(0);
    });
});

test('plain member: no setup checklist, and Resources frames the addons as Recommended mods', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member');
        await expect(page.getByTestId('guild-overview')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('setup-checklist'), 'the checklist is for editors').toHaveCount(0);

        await page.goto(`/guilds/${guild.guildId}#resources`);
        const frame = page.getByTestId('guild-recommended-mods');
        await expect(frame, 'the core frame now heads the WoW list (ROK-1830 S5b, D8-B)').toBeVisible({ timeout: 15_000 });
        await expect(frame.getByRole('heading', { name: 'Recommended mods' })).toBeVisible();
        await expect(frame.getByTestId('guild-mod-source-wow-addons')).toBeVisible();
        await expect(frame.getByRole('list', { name: 'Recommended addons' }), 'the WoW list keeps its own DOM').toBeVisible();
    });
})
