/**
 * Guild page content smoke (ROK-1786, S2 of ROK-1781) — every project
 * (desktop, tablet and mobile).
 *
 * Every test seeds its OWN guild through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` with `withContent: true` (a per-project,
 * per-worker, per-run name), which adds a GM post, two multi-line rule
 * sections, one link group, two recommended addons and (ROK-1868) three hub posts (CurseForge "Details!
 * Damage Meter" required, GitHub "WeakAuras" optional). Viewers are the
 * fixture's fresh users, each signed in with its own session; the edits land
 * on that run's guild only, and the seeded users are deleted in `finally`.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiDelete, apiPost, getAdminToken } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { editorTextbox, typeBoldLine } from './hub-post-editor';

type Role = 'gm' | 'officer' | 'member' | 'outsider';

interface SeededUser {
    userId: number;
    characterId: string | null;
}

interface SeededGuild {
    guildId: number;
    users: Record<Role, SeededUser>;
}

/** The fixture's GM post; its first line is the Players-card headline. */
const SEEDED_HEADLINE = 'Raid night is Tuesday 8pm server time.';
const CURSEFORGE_ADDON = 'Details! Damage Meter';
const GITHUB_ADDON = 'WeakAuras';
/** Pasted by the editor; the parser names it from the repo slug. */
const PASTED_URL = 'https://github.com/ledger-smoke/raid-checklist';
const PASTED_NAME = 'Raid Checklist';

/** A guild name unique to this project, worker and run (fixture: 3-48 chars). */
function guildName(testInfo: TestInfo): string {
    return `Content ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
}

async function seedGuild(token: string, testInfo: TestInfo): Promise<SeededGuild> {
    const body = (await apiPost(token, '/admin/test/wow/seed-guild', {
        name: guildName(testInfo),
        withContent: true,
    })) as Partial<SeededGuild> & { content?: { addonIds?: number[] } };
    if (typeof body.guildId !== 'number' || !body.users || body.content?.addonIds?.length !== 2) {
        throw new Error(`seed-guild withContent: ${JSON.stringify(body)}`);
    }
    return { guildId: body.guildId, users: body.users };
}

/** Seed a content guild, run `body`, and always delete the seeded users. */
async function withGuild(testInfo: TestInfo, body: (guild: SeededGuild) => Promise<void>) {
    const token = await getAdminToken();
    const guild = await seedGuild(token, testInfo);
    try {
        await body(guild);
    } finally {
        for (const user of Object.values(guild.users)) {
            await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    }
}

async function openGuildAs(page: Page, guild: SeededGuild, role: Role, hash = ''): Promise<void> {
    await signInOnboardedMember(page, guild.users[role].userId);
    await page.goto(`/guilds/${guild.guildId}${hash}`);
}

/** Every addon row (pinned first) in display order. */
function addonItems(page: Page): Locator {
    return page.getByRole('list', { name: 'Recommended addons' }).locator(':scope > li');
}

async function expectResourcesTab(page: Page): Promise<void> {
    const tabs = page.getByRole('navigation', { name: 'Guild page sections' });
    await expect(tabs.locator('a[href="#resources"]')).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
    await expect(page.getByTestId('guild-resources')).toBeVisible();
}

test('member: the GM post shows on Overview, read-only', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member');
        const post = page.getByTestId('guild-gm-post');
        // ROK-1868: the Overview card is the newest seeded hub post (bold headline + a bullet list).
        await expect(post.getByTestId('guild-gm-post-body')).toContainText(SEEDED_HEADLINE, { timeout: 15_000 });
        await expect(post.getByTestId('guild-gm-post-body').locator('li')).toHaveText(['Flasks', 'Food', 'Repair gold']);
        await expect(post.getByTestId('guild-gm-post-byline')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit the latest post' }), 'a plain member cannot edit the post').toHaveCount(0);
        await expect(page.getByTestId('hub-post-new'), 'a plain member cannot post').toHaveCount(0);
    });
});

test('member: Resources shows rules split by line, links, and addons with LedgerLink pinned first; no edit controls', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member', '#resources');
        await expectResourcesTab(page);
        // The cards are `<section aria-labelledby>` regions (WidgetCard) with no test id.
        const rules = page.getByRole('region', { name: 'Guild rules & loot rules' });
        await expect(rules.getByTestId('guild-rule-items')).toHaveCount(2);
        await expect(rules.getByTestId('guild-rule-items').first().locator('li'), 'one item per body line').toHaveText([
            'Loot council for tier pieces',
            'Main spec over off spec',
            'No trading raid drops',
        ]);
        const group = page.getByRole('region', { name: 'Links & resources' }).getByTestId('guild-link-group');
        await expect(group).toHaveCount(1);
        await expect(group.getByRole('link', { name: 'Raid strategy' })).toHaveAttribute('href', 'https://www.wowhead.com/classic/guides/raids');
        const items = addonItems(page);
        await expect(items.first(), 'the pinned LedgerLink row leads the list').toHaveAttribute('data-testid', 'guild-addon-pinned');
        await expect(items.first()).toContainText('LedgerLink');
        await expect(page.getByTestId('guild-addon-row')).toHaveText([new RegExp(CURSEFORGE_ADDON), new RegExp(GITHUB_ADDON)]);
        for (const id of ['guild-rules-edit', 'guild-links-edit', 'guild-addon-form']) {
            await expect(page.getByTestId(id), `${id} is editor-only`).toHaveCount(0);
        }
        await expect(page.getByRole('button', { name: `Remove ${CURSEFORGE_ADDON}` })).toHaveCount(0);
    });
});

test('editor (rank-1 officer): a new post becomes the Players card headline, markdown-stripped', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        const headline = `Smoke headline ${Date.now()}`;
        // ROK-1868: the GM post editor became the hub-post composer (TipTap); the headline is typed bold,
        // so the stored first line is `**headline**` and the Players card must show it stripped.
        await page.getByTestId('hub-post-new').click({ timeout: 15_000 });
        const composer = page.getByTestId('hub-post-composer');
        const frame = composer.getByTestId('hub-post-body');
        await (await editorTextbox(page, frame)).click();
        await typeBoldLine(page, frame, headline);
        await page.keyboard.press('Enter');
        await page.keyboard.type('Second line stays in the post.');
        await composer.getByTestId('hub-post-submit').click();
        await expect(composer).toHaveCount(0);
        const body = page.getByTestId('guild-gm-post-body');
        await expect(body.locator('strong')).toHaveText(headline);
        await expect(body).toContainText('Second line stays in the post.');
        await page.goto('/players');
        const card = page.getByTestId('players-guild-card');
        await expect(card.getByTestId('players-guild-headline'), 'the headline is the first line, without the ** markers').toHaveText(headline, { timeout: 15_000 });
    });
});

test('editor (rank-1 officer): adds an addon from a GitHub URL, reorders it, then removes it', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer', '#resources');
        await expectResourcesTab(page);
        const form = page.getByTestId('guild-addon-form');
        await form.getByLabel('Addon link').fill(PASTED_URL);
        await expect(form.getByTestId('guild-addon-preview')).toContainText(PASTED_NAME);
        await form.getByTestId('guild-addon-add').click();
        const rows = page.getByTestId('guild-addon-row');
        await expect(rows, 'a new addon appends last').toHaveText([
            new RegExp(CURSEFORGE_ADDON), new RegExp(GITHUB_ADDON), new RegExp(PASTED_NAME),
        ]);
        await page.getByRole('button', { name: `Move ${PASTED_NAME} up` }).click();
        await expect(rows).toHaveText([new RegExp(CURSEFORGE_ADDON), new RegExp(PASTED_NAME), new RegExp(GITHUB_ADDON)]);
        await page.reload();
        await expect(rows, 'the order persisted').toHaveText(
            [new RegExp(CURSEFORGE_ADDON), new RegExp(PASTED_NAME), new RegExp(GITHUB_ADDON)],
            { timeout: 15_000 },
        );
        await page.getByRole('button', { name: `Remove ${PASTED_NAME}` }).click();
        await expect(rows).toHaveText([new RegExp(CURSEFORGE_ADDON), new RegExp(GITHUB_ADDON)]);
        await expect(addonItems(page).first()).toContainText('LedgerLink');
    });
});

test('character page: the compact guild addons card for the member\'s character', async ({ page }, testInfo) => {
    await withGuild(testInfo, async (guild) => {
        const characterId = guild.users.member.characterId;
        if (characterId === null) throw new Error('seed-guild: the member has no character');
        await signInOnboardedMember(page, guild.users.member.userId);
        await page.goto(`/characters/${characterId}`);
        const card = page.getByTestId('character-guild-addons');
        await expect(card).toBeVisible({ timeout: 15_000 });
        await expect(card).toContainText('LedgerLink');
        await expect(card).toContainText(CURSEFORGE_ADDON);
        await expect(card).toContainText(GITHUB_ADDON);
    });
});
