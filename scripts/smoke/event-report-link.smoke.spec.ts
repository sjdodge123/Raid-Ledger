/**
 * ROK-1725 — the event detail "Logs" card: one combat-log report link.
 *
 * S1  the organiser (admin@local, the event's creator) sees a seeded Warcraft
 *     Logs link named after the site, opening in a new tab with
 *     `rel="noopener noreferrer"`.
 * S1b a non-organiser (the smoke-invitee member) sees the same link
 *     read-only — the card has no Edit / Remove / Add control.
 * S2  the organiser adds a link through the card: a foreign host shows the
 *     validation message and saves nothing (no PATCH, API still null), a
 *     Warcraft Logs link saves and renders, Edit swaps it for a
 *     foreverlogs.gg link, and Remove clears it back to the empty state.
 *
 * Every write is confirmed on `GET /events/:id` before the next UI assertion
 * (TESTING.md → "When to poll the API instead of the UI"). Selectors are
 * viewport-agnostic, so both Playwright projects run every test.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './base';
import {
    apiDelete,
    apiGet,
    apiPatch,
    apiPost,
    getAdminToken,
    getInviteeFixture,
    pollForCondition,
} from './api-helpers';
import { signInContextAs } from './browser-session';

const WCL_URL = 'https://classic.warcraftlogs.com/reports/SmokeAbc123';
const FOREVER_URL = 'https://foreverlogs.gg/reports/SmokeXyz789';
const FOREIGN_URL = 'https://example.com/x';
const FOREIGN_HOST_MSG = 'Only Warcraft Logs and foreverlogs.gg report links are accepted';
const EMPTY_STATE = /No logs linked yet\./;

let token: string;
/** Event seeded WITH a Warcraft Logs link (S1 / S1b). */
let linkedEventId: number | null = null;
/** Event seeded with NO link — the organiser edit flow (S2) drives it. */
let blankEventId: number | null = null;

async function createEvent(title: string): Promise<number> {
    const start = new Date(Date.now() + 2 * 86_400_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const event = (await apiPost(token, '/events', {
        title,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        maxAttendees: 10,
    })) as { id?: number };
    if (typeof event.id !== 'number') throw new Error(`POST /events returned no id: ${JSON.stringify(event)}`);
    return event.id;
}

/** Poll `GET /events/:id` until its `reportUrl` equals `expected`. */
async function waitForReportUrl(eventId: number, expected: string | null): Promise<void> {
    await pollForCondition(
        async () => {
            const event = (await apiGet(token, `/events/${eventId}`)) as { reportUrl?: string | null } | null;
            if (!event) return null;
            return (event.reportUrl ?? null) === expected ? event : null;
        },
        { timeoutMs: 15_000, description: `GET /events/${eventId} reportUrl === ${String(expected)}` },
    );
}

async function openCard(page: Page, eventId: number): Promise<Locator> {
    await page.goto(`/events/${eventId}`);
    const card = page.getByTestId('event-report-link-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole('heading', { name: 'Logs' })).toBeVisible();
    return card;
}

/** The link opens in a new tab with no opener and no referrer. */
async function expectSafeExternalLink(link: Locator, href: string, site: string): Promise<void> {
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleName(`View report on ${site}`);
    await expect(link).toHaveAttribute('href', href);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link, 'rel must carry noopener').toHaveAttribute('rel', /\bnoopener\b/);
    await expect(link, 'rel must carry noreferrer').toHaveAttribute('rel', /\bnoreferrer\b/);
}

test.beforeAll(async ({}, testInfo) => {
    token = await getAdminToken();
    const tag = `${testInfo.project.name}-${Date.now()}`;
    linkedEventId = await createEvent(`smoke-report-link-linked-${tag}`); // claimed before any assertion
    blankEventId = await createEvent(`smoke-report-link-blank-${tag}`);
    const patched = (await apiPatch(token, `/events/${linkedEventId}/report-link`, { reportUrl: WCL_URL })) as {
        reportUrl?: string | null;
    };
    if (patched.reportUrl !== WCL_URL) throw new Error(`seed PATCH report-link failed: ${JSON.stringify(patched)}`);
    await waitForReportUrl(linkedEventId, WCL_URL);
});

test.afterAll(async () => {
    for (const id of [linkedEventId, blankEventId]) {
        if (id !== null) await apiDelete(token, `/events/${id}`);
    }
    linkedEventId = null;
    blankEventId = null;
});

test.describe('Event report link card (ROK-1725)', () => {
    test('S1 organiser sees the seeded Warcraft Logs link, new tab, noopener + noreferrer', async ({ page }) => {
        if (linkedEventId === null) throw new Error('linked event was not seeded');
        const card = await openCard(page, linkedEventId);
        await expectSafeExternalLink(card.getByTestId('event-report-link'), WCL_URL, 'Warcraft Logs');
        await expect(card.getByRole('button', { name: 'Edit' }), 'the organiser can edit').toBeVisible();
        await expect(card.getByRole('button', { name: 'Remove' }), 'the organiser can remove').toBeVisible();
    });

    test('S1b non-organiser sees the link read-only with no edit control', async ({ page }) => {
        if (linkedEventId === null) throw new Error('linked event was not seeded');
        const invitee = await getInviteeFixture();
        await signInContextAs(page.context(), invitee.userId);
        const card = await openCard(page, linkedEventId);
        await expectSafeExternalLink(card.getByTestId('event-report-link'), WCL_URL, 'Warcraft Logs');
        await expect(card.getByRole('button'), 'a non-organiser gets no Edit / Remove / Add control').toHaveCount(0);
        await expect(card.getByRole('textbox')).toHaveCount(0);
    });

    test('S2 organiser adds, rejects a foreign host, edits and removes the link', async ({ page }) => {
        if (blankEventId === null) throw new Error('blank event was not seeded');
        const eventId = blankEventId;
        const patches: string[] = [];
        page.on('request', (req) => {
            if (req.method() === 'PATCH' && req.url().includes(`/events/${eventId}/report-link`)) {
                patches.push(req.postData() ?? '');
            }
        });

        const card = await openCard(page, eventId);
        await expect(card.getByText(EMPTY_STATE)).toBeVisible();
        await card.getByRole('button', { name: 'Add report link' }).click();
        const input = card.getByRole('textbox', { name: 'Report link' });

        // A foreign host: inline validation message, no request, nothing stored.
        await input.fill(FOREIGN_URL);
        await card.getByRole('button', { name: 'Save' }).click();
        await expect(card.getByText(FOREIGN_HOST_MSG)).toBeVisible();
        await expect(input, 'the editor stays open on a rejected link').toHaveValue(FOREIGN_URL);
        expect(patches, 'a foreign host must not send a PATCH').toEqual([]);
        await waitForReportUrl(eventId, null);

        // A Warcraft Logs link saves and renders.
        await input.fill(WCL_URL);
        await card.getByRole('button', { name: 'Save' }).click();
        await waitForReportUrl(eventId, WCL_URL);
        await expectSafeExternalLink(card.getByTestId('event-report-link'), WCL_URL, 'Warcraft Logs');
        await expect(card.getByText(FOREIGN_HOST_MSG)).toHaveCount(0);

        // Edit swaps it for a foreverlogs.gg link.
        await card.getByRole('button', { name: 'Edit' }).click();
        await expect(input).toHaveValue(WCL_URL);
        await input.fill(FOREVER_URL);
        await card.getByRole('button', { name: 'Save' }).click();
        await waitForReportUrl(eventId, FOREVER_URL);
        await expectSafeExternalLink(card.getByTestId('event-report-link'), FOREVER_URL, 'foreverlogs.gg');

        // Remove clears it back to the empty state.
        await card.getByRole('button', { name: 'Remove' }).click();
        await waitForReportUrl(eventId, null);
        await expect(card.getByTestId('event-report-link')).toHaveCount(0);
        await expect(card.getByText(EMPTY_STATE)).toBeVisible();
        expect(patches.map((body) => JSON.parse(body) as unknown)).toEqual([
            { reportUrl: WCL_URL },
            { reportUrl: FOREVER_URL },
            { reportUrl: null },
        ]);
    });
});
