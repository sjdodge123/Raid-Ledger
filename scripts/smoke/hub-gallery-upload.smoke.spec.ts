/**
 * ROK-1965 — Gallery member uploads, every project (desktop, mobile, tablet).
 *
 * On a community hub ("Seed Crew", see ./hub-gallery-upload-fixtures.ts) —
 * which only shows a Gallery card at all since the D14 widening:
 *  1. a member picks a PNG in the card's "Add picture" (`setInputFiles`, the
 *     real XHR upload) → 201 → "Picture added" → the new tile is first → the
 *     lightbox caption reads "Uploaded" → the member removes it themselves;
 *  2. a member's upload shows no Remove to a second member, and the hub
 *     Leader removes it.
 * Every picture is fresh random bytes (dedup would answer 200 / 409). Every
 * write is confirmed by polling the API; waits are response- or expect-driven.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import { signInOnboardedMember } from './browser-session';
import { listMedia, pollListed, seedUploadHub, uniquePng, uploadAs, type UploadHub } from './hub-gallery-upload-fixtures';

const card = (page: Page): Locator => page.locator('#hub-widget-core-gallery');
const dialog = (page: Page): Locator => page.getByRole('dialog', { name: 'Gallery' });
const caption = (page: Page): Locator => page.getByTestId('hub-gallery-caption');
const removeButton = (page: Page): Locator => dialog(page).getByRole('button', { name: 'Remove', exact: true });

function mediaWrite(page: Page, hubId: number, method: 'POST' | 'DELETE') {
    return page.waitForResponse(
        (r) => r.request().method() === method && new URL(r.url()).pathname.includes(`/hubs/${hubId}/media`),
        { timeout: 20_000 },
    );
}

async function openHub(page: Page, hub: UploadHub): Promise<void> {
    const list = page.waitForResponse(
        (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/hubs/${hub.hubId}/media`),
        { timeout: 15_000 },
    );
    await page.goto(`/hubs/${hub.hubId}`);
    expect((await list).status(), 'a member reads the hub Gallery').toBe(200);
    await expect(card(page), 'a community hub shows the Gallery card (D14)').toBeVisible({ timeout: 15_000 });
}

/** Open the newest picture (first tile) and confirm it is the `id` the API lists first. */
async function openNewest(page: Page, jwt: string, hub: UploadHub, id: number): Promise<void> {
    const first = (await listMedia(jwt, hub.hubId))[0];
    expect(first?.id, 'the upload is the newest picture').toBe(id);
    await card(page).getByTestId('hub-gallery-tile').first().click();
    await expect(dialog(page)).toBeVisible();
    await expect(caption(page), 'an upload is captioned "Uploaded"').toContainText('Uploaded');
    await expect(caption(page)).toContainText('Screenshot');
}

async function removeOpen(page: Page, hub: UploadHub): Promise<void> {
    await removeButton(page).click();
    const del = mediaWrite(page, hub.hubId, 'DELETE');
    await dialog(page).getByRole('button', { name: 'Remove for good' }).click();
    expect((await del).status(), 'remove answers 204').toBe(204);
}

test.describe('Hub Gallery — member uploads (ROK-1965)', () => {
    test('member: Add picture → tile first → "Uploaded" caption → removes their own', async ({ page }, testInfo) => {
        const hub = await seedUploadHub(testInfo);
        const jwt = await signInOnboardedMember(page, hub.uploaderId);
        await openHub(page, hub);

        const post = mediaWrite(page, hub.hubId, 'POST');
        await card(page).getByTestId('hub-gallery-add-picture-input').setInputFiles({
            name: 'smoke-upload.png',
            mimeType: 'image/png',
            buffer: uniquePng(),
        });
        const res = await post;
        expect(res.status(), 'new bytes are stored: 201').toBe(201);
        const { id } = (await res.json()) as { id: number };
        await expect(page.getByText('Picture added').first()).toBeVisible();
        await pollListed(jwt, hub.hubId, id, true);
        const mine = (await listMedia(jwt, hub.hubId)).find((i) => i.id === id);
        expect(mine?.canRemove, 'the uploader may remove their own picture').toBe(true);
        expect(mine?.source.type).toBe('upload');

        await openNewest(page, jwt, hub, id);
        await expect(removeButton(page), 'the uploader sees Remove').toBeVisible();
        await expect(dialog(page).getByRole('button', { name: 'Hide' }), 'a member never gets Hide').toHaveCount(0);
        await removeOpen(page, hub);
        await pollListed(jwt, hub.hubId, id, false);
    });

    test("second member: no Remove on someone else's upload; the Leader removes it", async ({ page }, testInfo) => {
        const hub = await seedUploadHub(testInfo);
        const uploaderJwt = await signInOnboardedMember(page, hub.uploaderId);
        const { id } = await uploadAs(uploaderJwt, hub.hubId, uniquePng());
        await pollListed(uploaderJwt, hub.hubId, id, true);

        const otherJwt = await signInOnboardedMember(page, hub.otherMemberId);
        const seen = (await listMedia(otherJwt, hub.hubId)).find((i) => i.id === id);
        expect(seen?.canRemove, "a member may not remove another member's picture").toBe(false);
        await openHub(page, hub);
        await openNewest(page, otherJwt, hub, id);
        await expect(removeButton(page), 'no Remove for a second member').toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toHaveCount(0);

        const leaderJwt = await signInOnboardedMember(page, hub.leaderUserId);
        await openHub(page, hub);
        await openNewest(page, leaderJwt, hub, id);
        await expect(removeButton(page), 'the hub Leader sees Remove').toBeVisible();
        await removeOpen(page, hub);
        await pollListed(leaderJwt, hub.hubId, id, false);
        await pollListed(uploaderJwt, hub.hubId, id, false);
    });
});
