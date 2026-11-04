/**
 * ROK-2075 — zoom inside the Gallery viewer (list viewer + single picture).
 * Runs in EVERY project: each test drives the gesture the project has —
 * mouse / keyboard on desktop, touch (Playwright touchscreen + CDP touch
 * drags, Chromium only like CI) on the phone and tablet projects. Pinch is
 * not scripted (no reliable multi-touch) — it is on the fleet test plan.
 *
 * Seed: like `hub-gallery.smoke.spec.ts` — the ROK-1930 deaths fixture gives
 * this worker a Valheim server hub + member, `POST /admin/test/hub-media/seed`
 * adds a fresh batch of pictures (counts read from the API, never assumed).
 * Single picture: like `guild-crest.smoke.spec.ts` — `seed-guild`, the officer
 * uploads a crest (`POST /guilds/:id/crest/upload`) and activates it, so the
 * crest opens the "Picture" viewer. Waits are response- or expect-driven only.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { API_BASE, apiDelete, apiGet, apiPost, apiPut, getAdminToken, pollForCondition } from './api-helpers';
import { signInContextAs, signInOnboardedMember } from './browser-session';
import { isDesktop } from './helpers';
import { type Fixture, responseTo, seedDeathsFixture } from './valheim-pin-filter-helpers';

const SEED_COUNT = 4;
const CREST_FIXTURE = join(__dirname, 'fixtures', 'guild-crest-96.png');

interface Point { x: number; y: number }

/** Server hub + ≥ SEED_COUNT pictures, confirmed through the list route. */
async function seed(testInfo: TestInfo): Promise<{ f: Fixture; total: number }> {
    const f = await seedDeathsFixture(testInfo.parallelIndex);
    const token = await getAdminToken();
    const res = (await apiPost(token, '/admin/test/hub-media/seed', { guildId: f.guildId, count: SEED_COUNT })) as { ids?: number[] };
    expect(res.ids, `hub-media seed: ${JSON.stringify(res)}`).toHaveLength(SEED_COUNT);
    const total = await pollForCondition(
        async () => {
            const body = (await apiGet(token, `/hubs/${f.guildId}/media?limit=1`)) as { total?: number } | null;
            return typeof body?.total === 'number' && body.total >= SEED_COUNT ? body.total : null;
        },
        { description: 'seeded pictures listed', timeoutMs: 15_000 },
    );
    return { f, total };
}

const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Gallery' });
const viewer = (page: Page): Locator => page.getByTestId('hub-gallery-viewer');
const stageIn = (scope: Locator): Locator => scope.getByTestId('hub-gallery-stage');
const zoomGroup = (scope: Locator): Locator => scope.getByRole('group', { name: 'Zoom' });
const position = (page: Page, n: number, total: number): Locator => viewer(page).getByText(`${n} of ${total}`, { exact: true });

/** `data-zoom` (2dp) as a number, for `expect.poll`. */
async function zoomOf(stage: Locator): Promise<number> {
    return Number(await stage.getAttribute('data-zoom'));
}

/** The picture's inline transform — changes when a drag pans it. */
async function transformOf(stage: Locator): Promise<string> {
    return stage.getByRole('img').evaluate((el) => (el as HTMLElement).style.transform);
}

async function centreOf(l: Locator): Promise<Point> {
    const b = await l.boundingBox();
    if (b === null) throw new Error('[hub-gallery-zoom] element has no bounding box');
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** One-finger drag through CDP touch events (pointerType "touch"), in small steps. */
async function touchDrag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= steps; i += 1) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

async function doubleTap(page: Page, at: Point): Promise<void> {
    await page.touchscreen.tap(at.x, at.y);
    await page.touchscreen.tap(at.x, at.y);
}

/** Member opens the hub, clicks the newest tile: the viewer shows "1 of N" at fit. */
async function openFirstPicture(page: Page, testInfo: TestInfo): Promise<{ total: number; stage: Locator }> {
    const { f, total } = await seed(testInfo);
    await signInContextAs(page.context(), f.users.member.id);
    const media = responseTo(page, `/hubs/${f.guildId}/media`);
    await page.goto(`/hubs/${f.guildId}`);
    expect((await media).status()).toBe(200);
    const card = page.locator('#hub-widget-core-gallery');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByTestId('hub-gallery-tile').first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(position(page, 1, total)).toBeVisible();
    const stage = stageIn(viewer(page));
    await expect(stage.getByRole('img'), 'the picture loaded').toBeVisible({ timeout: 15_000 });
    await expect(stage, 'opens at fit').toHaveAttribute('data-zoom', '1.00');
    return { total, stage };
}

test.describe('Hub Gallery viewer zoom (ROK-2075)', () => {
    test('Zoom in raises the zoom, Fit picture resets it, Next returns to fit', async ({ page }, testInfo) => {
        const { total, stage } = await openFirstPicture(page, testInfo);
        const group = zoomGroup(viewer(page));
        const readout = viewer(page).getByTestId('hub-gallery-zoom-readout');
        await expect(group.getByRole('button', { name: 'Zoom out' }), 'nothing to zoom out of at fit').toHaveAttribute('aria-disabled', 'true');
        await expect(readout).toHaveText('Fit');

        await group.getByRole('button', { name: 'Zoom in' }).click();
        await expect.poll(() => zoomOf(stage), { message: 'Zoom in raises data-zoom' }).toBeGreaterThan(1);
        await expect(readout).toHaveText(/^Zoom \d+%$/);
        await group.getByRole('button', { name: 'Fit picture' }).click();
        await expect(stage, 'Fit picture resets to 1.00').toHaveAttribute('data-zoom', '1.00');
        await expect(readout).toHaveText('Fit');

        await group.getByRole('button', { name: 'Zoom in' }).click();
        await expect.poll(() => zoomOf(stage)).toBeGreaterThan(1);
        await viewer(page).getByRole('button', { name: 'Next picture' }).click();
        await expect(position(page, 2, total)).toBeVisible();
        await expect(stage, 'a new picture opens at fit').toHaveAttribute('data-zoom', '1.00');
    });

    test('double-click (desktop) / double-tap (touch) zooms to 2.00 and back; Ctrl+wheel zooms on desktop', async ({ page }, testInfo) => {
        const { stage } = await openFirstPicture(page, testInfo);
        const at = await centreOf(stage);
        const desktop = isDesktop(testInfo);
        const toggle = desktop ? () => page.mouse.dblclick(at.x, at.y) : () => doubleTap(page, at);

        await toggle();
        await expect(stage, desktop ? 'double-click zooms to 2×' : 'double-tap zooms to 2×').toHaveAttribute('data-zoom', '2.00');
        await toggle();
        await expect(stage, 'a second double-click / double-tap returns to fit').toHaveAttribute('data-zoom', '1.00');
        if (!desktop) return;

        await page.mouse.move(at.x, at.y);
        await page.mouse.wheel(0, 120);
        await expect(stage, 'a plain wheel never zooms').toHaveAttribute('data-zoom', '1.00');
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -120);
        await page.keyboard.up('Control');
        await expect.poll(() => zoomOf(stage), { message: 'Ctrl+wheel up zooms in' }).toBeGreaterThan(1);
    });

    test('at fit ArrowRight (desktop) / a swipe (touch) walks to the next picture; zoomed it stays put', async ({ page }, testInfo) => {
        const { total, stage } = await openFirstPicture(page, testInfo);
        if (isDesktop(testInfo)) {
            await viewer(page).press('ArrowRight');
            await expect(position(page, 2, total), 'ArrowRight at fit walks on').toBeVisible();
            await zoomGroup(viewer(page)).getByRole('button', { name: 'Zoom in' }).click();
            await expect.poll(() => zoomOf(stage)).toBeGreaterThan(1);
            const zoomed = await stage.getAttribute('data-zoom');
            await viewer(page).press('ArrowRight');
            await expect(stage, 'ArrowRight while zoomed pans, the zoom holds').toHaveAttribute('data-zoom', zoomed ?? '');
            await expect(position(page, 2, total), 'ArrowRight while zoomed keeps the picture').toBeVisible();
            return;
        }
        const at = await centreOf(stage);
        await touchDrag(page, { x: at.x + 90, y: at.y }, { x: at.x - 90, y: at.y });
        await expect(position(page, 2, total), 'a left swipe at fit walks on').toBeVisible();
        await expect(stage.getByRole('img')).toBeVisible({ timeout: 15_000 });
        await doubleTap(page, at);
        await expect(stage).toHaveAttribute('data-zoom', '2.00');
        const before = await transformOf(stage);
        await touchDrag(page, { x: at.x + 60, y: at.y + 45 }, { x: at.x - 60, y: at.y - 45 });
        await expect.poll(() => transformOf(stage), { message: 'a drag while zoomed pans the picture' }).not.toBe(before);
        await expect(stage, 'the pan keeps the zoom').toHaveAttribute('data-zoom', '2.00');
        await expect(position(page, 2, total), 'a drag while zoomed never walks').toBeVisible();
    });

    test('single picture (an uploaded hub crest) has the Zoom group and zooms', async ({ page }, testInfo) => {
        const token = await getAdminToken();
        const name = `Zoom ${testInfo.project.name} w${testInfo.workerIndex} ${Date.now()}`;
        const seeded = (await apiPost(token, '/admin/test/wow/seed-guild', { name })) as {
            guildId?: number;
            users?: Record<string, { userId: number }>;
        };
        const officer = seeded.users?.officer;
        if (typeof seeded.guildId !== 'number' || !seeded.users || !officer) throw new Error(`seed-guild: ${JSON.stringify(seeded)}`);
        const { guildId, users } = { guildId: seeded.guildId, users: seeded.users };
        try {
            const jwt = await signInOnboardedMember(page, officer.userId);
            await uploadCrest(jwt, guildId);
            await page.goto(`/hubs/${guildId}`);
            await page.getByTestId('guild-hero').getByRole('button', { name: 'View hub picture', exact: true }).click({ timeout: 15_000 });
            const single = page.getByRole('dialog', { name: 'Picture' }).getByTestId('hub-gallery-single');
            const stage = stageIn(single);
            await expect(stage.getByRole('img'), 'the single viewer shows the crest').toBeVisible({ timeout: 15_000 });
            await expect(stage).toHaveAttribute('data-zoom', '1.00');
            const group = zoomGroup(single);
            await expect(group, 'the single picture has the Zoom group').toBeVisible();
            await group.getByRole('button', { name: 'Zoom in' }).click();
            await expect.poll(() => zoomOf(stage), { message: 'Zoom in on the single picture' }).toBeGreaterThan(1);
            await group.getByRole('button', { name: 'Fit picture' }).click();
            await expect(stage).toHaveAttribute('data-zoom', '1.00');
        } finally {
            for (const user of Object.values(users)) await apiDelete(token, `/users/${user.userId}`).catch(() => undefined);
        }
    });
});

/** The officer uploads the fixture crest and makes it the active crest; polled until it is. */
async function uploadCrest(jwt: string, guildId: number): Promise<void> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(readFileSync(CREST_FIXTURE))], { type: 'image/png' }), 'crest.png');
    const res = await fetch(`${API_BASE}/guilds/${guildId}/crest/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
        body: form,
    });
    if (res.status !== 200) throw new Error(`[hub-gallery-zoom] POST crest/upload → ${res.status}: ${await res.text()}`);
    await apiPut(jwt, `/guilds/${guildId}/crest`, { active: 'upload' });
    await pollForCondition(
        async () => {
            const state = (await apiGet(jwt, `/guilds/${guildId}/crest`)) as { active?: string } | null;
            return state?.active === 'upload' ? true : null;
        },
        { description: 'crest upload active' },
    );
}
