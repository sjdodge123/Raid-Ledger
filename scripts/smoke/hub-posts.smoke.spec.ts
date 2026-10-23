/**
 * Hub leader posts smoke (ROK-1868 §4 S1–S6; ROK-1898 S7 headings) — every project (desktop, tablet
 * and mobile; S6 is mobile-only).
 *
 * Each test seeds its OWN guild through the DEMO_MODE fixture
 * `POST /admin/test/wow/seed-guild` with `withContent: true` (per-project,
 * per-worker, per-run name), which seeds three hub posts, newest first:
 * a bold headline + 3-item bullet list + https link; an edited numbered list
 * with code/strike/app-relative link (−2 d); and the plain legacy GM post
 * (−9 d). No Discord channel is bound, so the relay switch is disabled and
 * nothing is ever sent to Discord from this spec.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { isPhoneLayout } from './helpers';
import { expectActiveHubTab } from './hub-tabs';
import {
    editorTextbox, heading, insertLinkViaRow, openGuildAs, tool, typeBoldLine, withContentGuild,
} from './hub-post-editor';

const NEWEST_HEADLINE = 'Raid night is Tuesday 8pm server time.';
const NEWEST_LINK = 'https://www.wowhead.com/classic/guides/raids';
/** Only the −9 d legacy post carries this sentence. */
const LEGACY_LINE = 'Bring flasks, food and repair gold.';
const OFFICER_HINT = 'Your guild master can link a Discord channel in Guild settings.';

function overviewBody(page: Page): Locator {
    return page.getByTestId('guild-gm-post').getByTestId('guild-gm-post-body');
}

function feedItems(page: Page): Locator {
    return page.getByTestId('hub-posts-tab').getByTestId('hub-post-item');
}

/** Posts may fold into the More menu below desktop width (ROK-1876), so assert it through the shared helper. */
async function expectPostsTab(page: Page, testInfo: TestInfo): Promise<void> {
    await expectActiveHubTab(page, testInfo, 'Posts', 'posts');
    await expect(page.getByTestId('hub-posts-tab')).toBeVisible();
}

/** The composed post's rendering: bold headline, two bullets, the example.com link. */
async function expectComposedFormatting(body: Locator): Promise<void> {
    await expect(body.locator('strong').first()).toHaveText('Raid moved', { timeout: 15_000 });
    await expect(body.locator('ul > li')).toHaveText(['Bring flasks', 'Bring food']);
    await expect(body.locator('a[href^="https://example.com"]'), 'the link row stored an https link').toHaveCount(1);
}

test('S1 member: Overview renders the newest post with its formatting; Previous posts lists 3 newest-first', async ({ page }, testInfo) => {
    await withContentGuild('Posts', testInfo, async (guild) => {
        await openGuildAs(page, guild, 'member');
        const body = overviewBody(page);
        await expect(body.locator('strong'), 'the **headline** renders bold').toHaveText(NEWEST_HEADLINE, { timeout: 15_000 });
        await expect(body.locator('ul > li')).toHaveText(['Flasks', 'Food', 'Repair gold']);
        await expect(body.locator('a[href^="https://"]')).toHaveAttribute('href', NEWEST_LINK);
        await expect(page.getByTestId('hub-post-new'), 'a plain member cannot post').toHaveCount(0);
        await page.getByTestId('hub-posts-previous').click();
        await expectPostsTab(page, testInfo);
        const items = feedItems(page);
        await expect(items).toHaveCount(3);
        await expect(items.nth(0)).toContainText('Repair gold');
        await expect(items.nth(1)).toContainText('Signup checklist');
        await expect(items.nth(2)).toContainText(LEGACY_LINE);
        await expect(page.getByTestId('hub-posts-tab').getByRole('button', { name: 'Delete' }), 'no edit controls for a member').toHaveCount(0);
    });
});

test('S2 officer: composes with the toolbar (bold, bullets, link row); the post renders formatted and survives a reload', async ({ page }, testInfo) => {
    await withContentGuild('Posts', testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        await page.getByTestId('hub-post-new').click({ timeout: 15_000 });
        const composer = page.getByTestId('hub-post-composer');
        const frame = composer.getByTestId('hub-post-body');
        const box = await editorTextbox(page, frame);
        await box.click();
        await typeBoldLine(page, frame, 'Raid moved');
        await page.keyboard.press('Enter');
        await tool(frame, 'bullets').click();
        await page.keyboard.type('Bring flasks');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Bring food');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter'); // an empty item lifts out of the list
        await page.keyboard.type('Guide: ');
        await insertLinkViaRow(frame, 'example.com');
        await expect(box.locator('strong')).toHaveText('Raid moved');
        const relay = composer.getByRole('switch', { name: 'Also post to Discord' });
        await expect(relay, 'no channel bound: the relay switch is disabled').toBeDisabled();
        await expect(composer.getByTestId('hub-post-relay-hint')).toHaveText(OFFICER_HINT);
        await composer.getByTestId('hub-post-submit').click();
        await expect(composer).toHaveCount(0);
        await expectComposedFormatting(overviewBody(page));
        await page.reload();
        await expectComposedFormatting(overviewBody(page));
    });
});

test('S3 officer edits the GM\'s latest post: prefilled with formatting, adds italic, shows Edited', async ({ page }, testInfo) => {
    await withContentGuild('Posts', testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        await page.getByTestId('hub-post-edit').click({ timeout: 15_000 });
        const editor = page.getByTestId('hub-post-editor');
        const frame = editor.getByTestId('hub-post-edit-body');
        const box = await editorTextbox(page, frame);
        await expect(box.locator('strong'), 'the stored markdown loads as formatting, not **text**').toHaveText(NEWEST_HEADLINE);
        await box.click();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.press('Enter');
        await tool(frame, 'italic').click();
        await page.keyboard.type('Italic note');
        await editor.getByTestId('hub-post-save').click();
        await expect(editor).toHaveCount(0);
        const body = overviewBody(page);
        await expect(body.locator('em')).toHaveText('Italic note');
        await expect(body.locator('strong')).toHaveText(NEWEST_HEADLINE);
        await expect(page.getByTestId('guild-gm-post-byline')).toContainText('Edited');
    });
});

test('S4 officer deletes a post through the confirm (Modal on desktop, bottom sheet below 1024px)', async ({ page }, testInfo) => {
    await withContentGuild('Posts', testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer', '#posts');
        await expectPostsTab(page, testInfo);
        const items = feedItems(page);
        await expect(items).toHaveCount(3);
        await items.filter({ hasText: LEGACY_LINE }).getByRole('button', { name: 'Delete' }).click();
        const dialog = page.getByRole('dialog', { name: 'Delete this post?' });
        await expect(dialog.getByTestId('hub-post-delete-dialog')).toBeVisible();
        await expect(page.getByTestId('bottom-sheet-footer'), 'phone layout = BottomSheet, desktop = Modal')
            .toHaveCount(isPhoneLayout(testInfo) ? 1 : 0);
        await page.getByTestId('hub-post-delete-confirm').click();
        await expect(dialog).toHaveCount(0);
        await expect(items).toHaveCount(2);
        await expect(items.filter({ hasText: LEGACY_LINE })).toHaveCount(0);
        await page.reload();
        await expect(items, 'the delete persisted').toHaveCount(2, { timeout: 15_000 });
    });
});

test('S5 member: a ?post deep link opens the Posts tab with that post expanded and highlighted', async ({ page }, testInfo) => {
    await withContentGuild('Posts', testInfo, async (guild) => {
        const oldest = guild.postIds[2];
        if (oldest === undefined) throw new Error('seed-guild: no oldest post id');
        await openGuildAs(page, guild, 'member', `?post=${oldest}#posts`);
        await expectPostsTab(page, testInfo);
        const linked = page.locator(`article#post-${oldest}`);
        await expect(linked).toHaveAttribute('aria-current', 'true', { timeout: 15_000 });
        await expect(linked).toContainText(LEGACY_LINE);
        // The seeded oldest post is one short line: it opens unclamped, so it offers no Show more/less toggle
        // (ROK-1868 review MAJOR — a short deep-linked post must not show "Show less").
        await expect(linked.getByRole('button', { name: /^Show (less|more)$/ }), 'a short deep-linked post opens in full, with no toggle').toHaveCount(0);
        await expect(page.locator('article[aria-current="true"]'), 'only the linked post is highlighted').toHaveCount(1);
    });
});

const H1_TEXT = 'Raid plan';
const H2_TEXT = 'Loot rules';

/** ROK-1898: the composed headings render as h3 (`#`) + h4 (`##`) with their levels, and no literal `#` survives. */
async function expectComposedHeadings(scope: Locator, what: string): Promise<void> {
    await expect(heading(scope, 1), `${what}: the toolbar H1 line is a level-1 heading (h3)`).toHaveText(H1_TEXT, { timeout: 15_000 });
    await expect(heading(scope, 2), `${what}: the "## " line is a level-2 heading (h4)`).toHaveText(H2_TEXT);
    await expect(scope.locator('[data-md-heading]'), `${what}: exactly the two composed headings`).toHaveCount(2);
    await expect(scope, `${what}: the paragraph survives`).toContainText('Bring flasks.');
    await expect(scope, `${what}: no markdown # leaks into the rendered text`).not.toContainText('#');
}

test('S7 officer: H1 from the toolbar + "## " input rule render as card headings and round-trip into the editor', async ({ page }, testInfo) => {
    await withContentGuild('Posts', testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        await page.getByTestId('hub-post-new').click({ timeout: 15_000 });
        const composer = page.getByTestId('hub-post-composer');
        const frame = composer.getByTestId('hub-post-body');
        const box = await editorTextbox(page, frame);
        await box.click();
        await tool(frame, 'h1').click();
        await expect(tool(frame, 'h1'), 'the caret line is now a level-1 heading').toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.type(H1_TEXT);
        await page.keyboard.press('Enter'); // Enter at the end of a heading starts a paragraph
        await expect(tool(frame, 'h1'), 'the new line is a paragraph').toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.type('Bring flasks.');
        await page.keyboard.press('Enter');
        await page.keyboard.type('## ');
        await expect(tool(frame, 'h2'), 'the "## " input rule converted the line').toHaveAttribute('aria-pressed', 'true');
        await page.keyboard.type(H2_TEXT);
        await page.keyboard.press('Enter');
        await page.keyboard.type('Need before greed.');
        await expectComposedHeadings(box, 'editor before publish');
        const created = page.waitForResponse((res) => res.request().method() === 'POST'
            && new URL(res.url()).pathname.endsWith(`/guilds/${guild.guildId}/posts`));
        await composer.getByTestId('hub-post-submit').click();
        expect((await created).status(), 'POST /guilds/:id/posts succeeds').toBeLessThan(300);
        await expect(composer).toHaveCount(0);
        await expectComposedHeadings(overviewBody(page), 'Overview card');
        await page.reload();
        await expectComposedHeadings(overviewBody(page), 'Overview card after reload');
        await page.getByTestId('hub-post-edit').click({ timeout: 15_000 });
        const editFrame = page.getByTestId('hub-post-editor').getByTestId('hub-post-edit-body');
        await expectComposedHeadings(await editorTextbox(page, editFrame), 're-opened editor');
    });
});

test('S6 mobile: the toolbar is one horizontally scrolling row and the composer stays inline', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'S6 pins the phone toolbar (Pixel 5 width)');
    await withContentGuild('Posts', testInfo, async (guild) => {
        await openGuildAs(page, guild, 'officer');
        await page.getByTestId('hub-post-new').click({ timeout: 15_000 });
        const frame = page.getByTestId('hub-post-composer').getByTestId('hub-post-body');
        await editorTextbox(page, frame);
        await expect(page.getByRole('dialog'), 'the composer is inline, not a dialog').toHaveCount(0);
        const bar = frame.getByRole('toolbar', { name: 'Formatting' });
        const box = await bar.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
        expect(box.scroll, `toolbar scrollWidth ${box.scroll} > clientWidth ${box.client}`).toBeGreaterThan(box.client);
        const tops = await bar.getByRole('button').evaluateAll((els) => els.map((el) => (el instanceof HTMLElement ? el.offsetTop : -1)));
        expect(new Set(tops).size, `one row of tools, offsetTops ${JSON.stringify(tops)}`).toBe(1);
        for (const key of ['bold', 'italic', 'strike', 'code', 'link', 'bullets', 'numbers'] as const) {
            const button = tool(frame, key);
            await button.scrollIntoViewIfNeeded();
            await expect(button, `md-tool-${key} is reachable by scrolling`).toBeInViewport();
        }
    });
});
