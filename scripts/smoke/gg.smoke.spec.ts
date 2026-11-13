/**
 * ROK-2187 — "GG <year>": the player's story, archive, public share page and
 * the admin GG panel (mascot picker), desktop + mobile.
 *
 * Seeds a frozen snapshot through the DEMO_MODE fixture `POST /admin/test/gg/seed`
 * (core cards only, literal values, no IGDB names) for a per-worker year, so the
 * desktop and mobile projects never share a `(user, year)` row. The mascot
 * picker's Discord options and its save are mocked with `page.route` — nothing
 * reaches Discord or its CDN.
 */
import { test, expect } from './base';
import type { Page, Route } from '@playwright/test';
import { API_BASE, getAdminToken } from './api-helpers';
import { jwtSub } from './browser-session';
import { isPhoneLayout } from './helpers';
import {
    MASCOT_EMOJI_ID, MASCOT_OPTIONS, MASCOT_SOUND_ID, OWNER_MASCOT,
    ggCoPlayerName, ggSmokeYear, publicGgCardStatus, publicGgStatus, resetGgYear, seedGgSnapshot,
} from './gg-fixtures';

let token = '';
let year = 0;

test.beforeAll(async ({}, testInfo) => {
    year = ggSmokeYear(testInfo.parallelIndex);
    token = await getAdminToken();
    await seedGgSnapshot(token, jwtSub(token), year);
});

test.afterAll(async () => {
    if (token && year) await resetGgYear(token, year);
});

/** Below 1024px (phone AND tablet projects, ROK-1584) StoryViewer renders its
 * phone layout and both projects have touch, so they page by tap. */
function phoneLayout(): boolean {
    return isPhoneLayout(test.info());
}

/** The polite live region StoryViewer keeps current: "Slide n of m: label". */
function slideStatus(page: Page) {
    return page.getByTestId('story-viewer').getByText(/^Slide \d+ of \d+:/);
}

/** Opens the seeded year and presses "Tap to start"; pauses auto-advance. */
async function openAndStart(page: Page): Promise<void> {
    await page.goto(`/gg/${year}`);
    const gate = page.getByTestId('gg-tap-to-start');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(gate).toContainText('Tap to start');
    await expect(slideStatus(page)).toHaveText(/^Slide 1 of 4:/);
    if (phoneLayout()) await gate.tap();
    else await gate.click();
    await expect(gate).toBeHidden();
    const pause = page.getByRole('button', { name: 'Pause story' });
    if (await pause.isVisible().catch(() => false)) await pause.click();
}

/** Next card: ArrowRight on desktop, a tap on the right tap zone on a phone. */
async function next(page: Page): Promise<void> {
    if (phoneLayout()) await page.getByRole('button', { name: 'Next slide' }).tap();
    else await page.keyboard.press('ArrowRight');
}

/** From the intro to the Summary card (4 cards seeded). */
async function toSummary(page: Page): Promise<void> {
    for (const n of [2, 3, 4]) {
        await next(page);
        await expect(slideStatus(page)).toHaveText(new RegExp(`^Slide ${n} of 4:`));
    }
}

test.describe('GG year story (ROK-2187)', () => {
    test('opens the seeded snapshot behind "Tap to start" and navigates the cards', async ({ page }) => {
        await openAndStart(page);
        await next(page);
        await expect(slideStatus(page)).toHaveText(/^Slide 2 of 4:/);
        await next(page);
        await expect(slideStatus(page)).toHaveText(/^Slide 3 of 4:/);
        // The People card is owner-only — the co-player's name shows here and nowhere public.
        await expect(page.getByText(ggCoPlayerName(year))).toBeVisible();
    });

    test('desktop: centred card with side arrows that page the story', async ({ page }) => {
        test.skip(phoneLayout(), 'Desktop-only — below 1024px the story pages by tap zones, no side arrows');
        await openAndStart(page);
        await expect(page.getByTestId('story-viewer')).toHaveAttribute('data-layout', 'desktop');
        await expect(page.getByTestId('story-side-arrow-prev')).toBeVisible();
        await expect(page.getByTestId('story-side-arrow-next')).toBeVisible();
        await page.getByTestId('story-side-arrow-next').click();
        await expect(slideStatus(page)).toHaveText(/^Slide 2 of 4:/);
        await page.keyboard.press('ArrowLeft');
        await expect(slideStatus(page)).toHaveText(/^Slide 1 of 4:/);
    });

    test('mobile: phone layout without side arrows', async ({ page }) => {
        test.skip(!phoneLayout(), 'Phone-layout assertion (phone + tablet)');
        await openAndStart(page);
        await expect(page.getByTestId('story-viewer')).toHaveAttribute('data-layout', 'phone');
        await expect(page.getByTestId('story-side-arrow-next')).toHaveCount(0);
    });

    test('the archive lists the seeded year and opens it', async ({ page }) => {
        await page.goto('/gg/archive');
        const link = page.getByRole('link', { name: new RegExp(`GG ${year}`) });
        await expect(link).toBeVisible({ timeout: 15_000 });
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/gg/${year}$`));
        await expect(page.getByTestId('gg-tap-to-start')).toBeVisible();
    });
});

/** Turns the Summary card's share switch to `on` and waits for the state. */
async function setShare(page: Page, on: boolean): Promise<void> {
    const toggle = page.getByRole('switch', { name: `Share my GG ${year} publicly` });
    await expect(toggle).toBeEnabled();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

test.describe('GG public share (ROK-2187, Q4/Q5)', () => {
    test('share on → signed-out /w/:slug shows the summary only; off → not found', async ({ page, browser }) => {
        await openAndStart(page);
        await toSummary(page);
        await setShare(page, true);
        const shareUrl = (await page.getByTestId('gg-share-url').textContent())?.trim() ?? '';
        expect(shareUrl, 'share URL after toggling on').toMatch(/\/w\/[^/]+$/);
        const slug = shareUrl.slice(shareUrl.lastIndexOf('/') + 1);

        const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
            const pub = await anon.newPage();
            await pub.goto(shareUrl, { waitUntil: 'domcontentloaded' });
            await expect(pub.getByText(/^(person|people) played with$/)).toBeVisible({ timeout: 15_000 });
            await expect(pub.getByText(`GG ${year}`)).toBeVisible();
            await expect(pub.locator('body')).not.toContainText(ggCoPlayerName(year));
            await expect(pub.locator('body')).not.toContainText(/@local\b|@[a-z0-9-]+\.[a-z]{2,}/i);

            await setShare(page, false);
            await expect.poll(() => publicGgStatus(slug), { message: 'public DTO after revoke' }).toBe(404);
            await pub.reload();
            await expect(pub.getByTestId('gg-public-missing')).toBeVisible({ timeout: 15_000 });
        } finally {
            await anon.close();
        }
    });

    test('share PNG URL answers 200 while shared and 404 after revoke', async ({ page }) => {
        await openAndStart(page);
        await toSummary(page);
        await setShare(page, true);
        const shareUrl = (await page.getByTestId('gg-share-url').textContent())?.trim() ?? '';
        const slug = shareUrl.slice(shareUrl.lastIndexOf('/') + 1);
        expect(slug, 'share slug after toggling on').toMatch(/^[A-Za-z0-9_-]{16,64}$/);

        const png = await fetch(`${API_BASE}/gg/public/${encodeURIComponent(slug)}/card`);
        expect(png.status).toBe(200);
        expect(png.headers.get('content-type')).toBe('image/png');
        expect(png.headers.get('cache-control')).toBe('public, no-cache');
        expect(png.headers.get('etag')).toMatch(/^"[0-9a-f]{32}"$/);
        const magic = Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex');
        expect(magic, 'PNG signature').toBe('89504e470d0a1a0a');

        await setShare(page, false);
        await expect.poll(() => publicGgCardStatus(slug), { message: 'share PNG after revoke' }).toBe(404);
    });
});

/** Mocks the picker's Discord reads; returns the captured PATCH bodies. */
async function mockMascotRoutes(page: Page): Promise<unknown[]> {
    const saved: unknown[] = [];
    await page.route('https://cdn.discordapp.com/**', (route: Route) => route.abort());
    await page.route(/\/admin\/gg\/mascot\/options(?:\?|$)/, (route: Route) => route.fulfill({ json: MASCOT_OPTIONS }));
    await page.route(/\/admin\/gg\/mascot(?:\?|$)/, async (route: Route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        saved.push(route.request().postDataJSON());
        return route.fulfill({ json: { ...OWNER_MASCOT, emojiId: MASCOT_EMOJI_ID, animated: false, soundId: MASCOT_SOUND_ID, soundName: 'smoke chime' } });
    });
    return saved;
}

test.describe('Admin GG panel (ROK-2187 L10)', () => {
    test('renders settings, runs a dry run, and saves a mascot pick', async ({ page }) => {
        const saved = await mockMascotRoutes(page);
        await page.goto('/admin/settings/general/gg');
        await expect(page.getByTestId('gg-admin-panel')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('gg-enabled')).toHaveAttribute('aria-checked', /true|false/);

        await page.getByTestId('gg-dry-run').click();
        await expect(page.getByTestId('gg-dry-run-result')).toBeVisible({ timeout: 15_000 });

        const section = page.getByTestId('gg-mascot-section');
        await expect(section.getByTestId('gg-mascot-current')).toBeVisible();
        await section.getByText('From Discord', { exact: true }).click();
        await section.getByTestId(`gg-mascot-emoji-${MASCOT_EMOJI_ID}`).click();
        await section.getByTestId(`gg-mascot-sound-${MASCOT_SOUND_ID}`).click();
        await section.getByTestId('gg-mascot-save').click();
        await expect.poll(() => saved.length, { message: 'PATCH /admin/gg/mascot sent' }).toBe(1);
        expect(saved[0]).toEqual({ emojiId: MASCOT_EMOJI_ID, soundId: MASCOT_SOUND_ID });
    });

    test('bot offline: the picker says so', async ({ page }) => {
        await page.route(/\/admin\/gg\/mascot\/options(?:\?|$)/, (route: Route) =>
            route.fulfill({ status: 503, json: { statusCode: 503, message: 'Discord bot is offline' } }));
        await page.goto('/admin/settings/general/gg');
        const section = page.getByTestId('gg-mascot-section');
        await expect(section).toBeVisible({ timeout: 15_000 });
        await section.getByText('From Discord', { exact: true }).click();
        await expect(section.getByTestId('gg-mascot-bot-offline')).toBeVisible({ timeout: 15_000 });
    });

    test('with a mascot the story opens on "Tap to start" with the sound warning', async ({ page }) => {
        await page.route(new RegExp(`/gg/${year}(?:\\?|$)`), async (route: Route) => {
            const type = route.request().resourceType();
            if (type !== 'fetch' && type !== 'xhr') return route.continue();
            const res = await route.fetch();
            const body = (await res.json()) as Record<string, unknown>;
            return route.fulfill({ response: res, json: { ...body, mascot: OWNER_MASCOT } });
        });
        await page.goto(`/gg/${year}`);
        const gate = page.getByTestId('gg-tap-to-start');
        await expect(gate).toBeVisible({ timeout: 15_000 });
        await expect(gate).toContainText('Tap to start');
        await expect(gate).toContainText('This plays sound');
        await expect(page.locator(`img[alt="${OWNER_MASCOT.emojiName}"]`)).toBeAttached();
    });
});
