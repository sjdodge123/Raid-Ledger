/**
 * ROK-1893 P4 — calendar entries show their hub (desktop + mobile).
 *
 * Seed: `POST /admin/test/community-hubs/seed {gameId, withEvent: true}` (DEMO_MODE) recreates
 * the community-hub fixture and ONE event tagged (`guild_id`) to "Seed Crew",
 * 3h long (the Week card's `compact` tier, which shows the hub), starting 1–2h
 * from now (or 18:00 UTC tomorrow if it would cross UTC midnight); its title
 * carries the hub id, so it is unique per seed. The response's `hubEvent` gives its id/title/startTime.
 *
 * ## Determinism
 * - Concurrency: the seed clears by game, so each project seeds a DIFFERENT
 *   configured game, offset past `community-hubs` (slots 0–2) and `hubs-nav`
 *   (3–5). Every locator is keyed to this seed's event title or hub id, never
 *   to "the first card" or the hub's (shared) name.
 * - The API is polled for the event's `hub` ref before the first render, and
 *   the date is computed in the BROWSER in the app's timezone, then
 *   deep-linked with `?date=` (the event can fall into next week late Saturday).
 * - Views: desktop clicks the toolbar's Week button (the page forces Month on
 *   mount); the phone opens on its Schedule agenda. The tablet project is
 *   skipped — the fleet test plan covers it (F7/F8).
 * - The Hubs filter is session-only, so unticking it writes nothing to
 *   restore; it is re-ticked in-test anyway to prove the round trip.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken, pollForCondition } from './api-helpers';
import { signInOnboardedMember } from './browser-session';
import { isDesktop, isTablet } from './helpers';

interface HubSeed {
    gameId: number;
    hubIds: { crew: number };
    leaderUserId: number;
    hubEvent: { id: number; title: string; startTime: string };
}

const HUB_NAME = 'Seed Crew';
const PROJECT_SLOT: Record<string, number> = { desktop: 0, mobile: 1, tablet: 2 };

/** Fail loudly on a missing element (strict flags: no `!`). */
function must<T>(value: T | undefined | null, label: string): T {
    if (value === undefined || value === null) throw new Error(`[calendar-hub] missing ${label}`);
    return value;
}

/** One configured game per project, clear of the other community-hub seeders. */
async function projectGameId(token: string, testInfo: TestInfo): Promise<number> {
    const body = (await apiGet(token, '/games/configured')) as { data?: unknown } | unknown[] | null;
    const raw = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    const ids = raw
        .map((g) => (g as { id?: unknown }).id)
        .filter((id): id is number => typeof id === 'number')
        .sort((a, b) => a - b);
    if (ids.length === 0) throw new Error('[calendar-hub] GET /games/configured returned no games');
    const slot = PROJECT_SLOT[testInfo.project.name] ?? 0;
    return must(ids[(6 + slot) % ids.length], 'project game id');
}

const isHubSeed = (b: unknown): b is HubSeed => {
    const s = b as Partial<HubSeed> | null;
    return typeof s?.leaderUserId === 'number' && typeof s.hubIds?.crew === 'number'
        && typeof s.hubEvent?.id === 'number' && typeof s.hubEvent.title === 'string';
};

/** Seed, then poll until `GET /events/:id` carries the crew hub ref. */
async function seedHubEvent(testInfo: TestInfo): Promise<HubSeed> {
    const token = await getAdminToken();
    const gameId = await projectGameId(token, testInfo);
    const body: unknown = await apiPost(token, '/admin/test/community-hubs/seed', { gameId, withEvent: true });
    if (!isHubSeed(body)) throw new Error(`[calendar-hub] seed: ${JSON.stringify(body)}`);
    await pollForCondition(async () => {
        const ev = (await apiGet(token, `/events/${body.hubEvent.id}`)) as { hub?: { id?: number } | null } | null;
        return ev?.hub?.id === body.hubIds.crew ? true : null;
    }, { timeoutMs: 15_000, description: `GET /events/${body.hubEvent.id} hub = ${body.hubIds.crew}` });
    return body;
}

/** `iso` as a yyyy-MM-dd date in the app's timezone, measured in the browser. */
async function appDate(page: Page, iso: string): Promise<string> {
    return page.evaluate((at) => {
        const pref = localStorage.getItem('raid_ledger_timezone');
        const timeZone = pref && pref !== 'auto' ? pref : undefined;
        return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
            .format(new Date(at));
    }, iso);
}

/** Week grid (desktop) or the Schedule agenda (phone) on the event's date. */
async function openCalendar(page: Page, testInfo: TestInfo, seed: HubSeed): Promise<void> {
    await page.goto(`/calendar?date=${await appDate(page, seed.hubEvent.startTime)}`);
    if (isDesktop(testInfo)) {
        await page.getByRole('button', { name: 'Week', exact: true }).click({ timeout: 15_000 });
        await expect(page.locator('.rbc-time-view')).toBeVisible({ timeout: 15_000 });
    }
}

/** This seed's entry: the Week card (desktop) or the agenda row (phone). */
function entryOf(page: Page, testInfo: TestInfo, seed: HubSeed): Locator {
    const scope = isDesktop(testInfo) ? page.locator('.rbc-event') : page.getByTestId('schedule-day').locator('button');
    return scope.filter({ hasText: seed.hubEvent.title });
}

/** The Filters entry, opened: the toolbar funnel's panel ≥1024px, else the FAB's sheet. */
async function openFilters(page: Page, testInfo: TestInfo): Promise<Locator> {
    if (isDesktop(testInfo)) {
        await page.getByTestId('filter-panel-trigger').click({ timeout: 15_000 });
        return page.getByTestId('filter-panel');
    }
    await page.getByTestId('filter-fab').click({ timeout: 15_000 });
    const sheet = page.getByRole('dialog', { name: 'Filters' });
    await expect(sheet).toBeVisible({ timeout: 5_000 });
    return sheet;
}

test.describe('calendar — hub provenance (ROK-1893 P4)', () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    // A non-UTC browser could push the 3h event across local midnight, off the Week grid's timed column.
    test.use({ timezoneId: 'UTC' });

    test.beforeEach(({}, testInfo) => {
        test.skip(isTablet(testInfo), 'desktop + phone only; the fleet test plan covers tablet');
    });

    test('the entry names its hub; unticking the hub in Filters hides it', async ({ page }, testInfo) => {
        const seed = await seedHubEvent(testInfo);
        await signInOnboardedMember(page, seed.leaderUserId);
        await openCalendar(page, testInfo, seed);

        const entry = entryOf(page, testInfo, seed);
        await expect(entry).toHaveCount(1, { timeout: 15_000 });
        await expect(entry.getByTestId('event-hub-label')).toHaveText(`· ${HUB_NAME}`);

        const panel = await openFilters(page, testInfo);
        const hubBox = panel.getByTestId(`calendar-hub-toggle-${seed.hubIds.crew}`);
        await expect(hubBox).toBeChecked({ timeout: 10_000 });
        await expect(panel.getByTestId('calendar-hub-toggle-none')).toBeChecked();
        await hubBox.uncheck();
        await expect(entry).toHaveCount(0, { timeout: 10_000 });
        await hubBox.check();
        await expect(entry).toHaveCount(1, { timeout: 10_000 });
    });

    test('the event page links to the hub', async ({ page }, testInfo) => {
        const seed = await seedHubEvent(testInfo);
        await signInOnboardedMember(page, seed.leaderUserId);
        await page.goto(`/events/${seed.hubEvent.id}`);
        const link = page.getByTestId('event-banner-hub').filter({ visible: true }).first();
        await expect(link).toBeVisible({ timeout: 15_000 });
        await expect(link).toHaveAttribute('href', `/guilds/${seed.hubIds.crew}`);
        await expect(link).toContainText(`${HUB_NAME} hub`);
        await link.click();
        await expect(page).toHaveURL(new RegExp(`/guilds/${seed.hubIds.crew}(?:[/?#]|$)`), { timeout: 15_000 });
    });
});
