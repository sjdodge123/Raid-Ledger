/**
 * ROK-1728 (spec §6.4, AC10) — join a weekly series once, skip one night,
 * leave the series.
 *
 * The admin creates a weekly series of 3 future nights through the API, then
 * drives the event page: Join series → the overlay (Modal on desktop,
 * BottomSheet on mobile — both carry `join-series-confirm`) → "In for the
 * series" on every night, the labelled roster `SeriesBadge` on night 3,
 * Skip this night on night 2 brings the sign-up button back there only, and
 * Leave series → its confirm takes every night off (Sign Up returns on
 * nights 1 and 3). Join series does NOT return: leave declines every night,
 * so joinableCount is 0 and JoinSeriesButton hides (spec §6.4 says otherwise
 * — flagged to the Lead).
 *
 * Every API write is followed by a poll of `GET /events/:id/series/signup`
 * (memory feedback_smoke_polling_for_async_writes). Each project creates its
 * own series (title carries the project name), so desktop and mobile never
 * share a membership. afterAll deletes the whole series (`scope=all`).
 */
import type { Page } from '@playwright/test';
import { test, expect } from './base';
import { getAdminToken, apiGet, apiPost, apiDelete, pollForCondition } from './api-helpers';

const DAY = 86_400_000;
const NIGHTS = 3;
/** The roster badge title (player-card / EventDetailRoster); the header's recurring badge says "Recurring series". */
const ROSTER_BADGE = '[data-testid="series-badge"][title="Signed up for the series"]';
const SIGN_UP = /^(Join Event|Sign Up for Event)$/;

interface Night { eventId: number; startTime: string; state: string }
interface SeriesState { nights: Night[]; membership: { status: string } | null; joinableCount: number }

let token: string;
let anchorId: number | null = null;
let nightIds: number[] = [];

/** `GET /events/:id/series/signup`, narrowed to the fields this spec reads. */
async function readState(eventId: number): Promise<SeriesState | null> {
    const raw: SeriesState | null = await apiGet(token, `/events/${eventId}/series/signup`);
    if (!raw || !Array.isArray(raw.nights)) return null;
    return raw;
}

/** POST a weekly series of NIGHTS future nights; returns the first night's id. */
async function createSeries(title: string): Promise<number> {
    const start = new Date(Date.now() + 2 * DAY);
    const until = new Date(start.getTime() + (NIGHTS - 1) * 7 * DAY + 3_600_000);
    const created: unknown = await apiPost(token, '/events', {
        title,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 2 * 3_600_000).toISOString(),
        maxAttendees: 10,
        recurrence: { frequency: 'weekly', until: until.toISOString() },
    });
    const first: unknown = Array.isArray(created) ? created[0] : created;
    if (typeof first !== 'object' || first === null || !('id' in first) || typeof first.id !== 'number') {
        throw new Error(`POST /events (recurring) returned no id: ${JSON.stringify(created).slice(0, 300)}`);
    }
    return first.id;
}

test.beforeAll(async ({}, testInfo) => {
    token = await getAdminToken();
    anchorId = await createSeries(`smoke-series-signup-${testInfo.project.name}-${Date.now()}`);
    const id = anchorId;
    const state = await pollForCondition(async () => {
        const s = await readState(id);
        return s && s.nights.length === NIGHTS ? s : null;
    }, { description: `series ${id} materialises ${NIGHTS} nights` });
    nightIds = [...state.nights]
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .map((n) => n.eventId);
});

test.afterAll(async () => {
    if (anchorId !== null) await apiDelete(token, `/events/${anchorId}/series?scope=all`);
    anchorId = null;
});

/** The id of night `i` (0-based); fails loudly when the seed went wrong. */
function night(i: number): number {
    const id = nightIds[i];
    if (id === undefined) throw new Error(`night ${i} missing from ${JSON.stringify(nightIds)}`);
    return id;
}

/** Wait until the API reports the admin's series membership as active (or not). */
async function expectMembership(active: boolean): Promise<void> {
    const id = night(0);
    await pollForCondition(async () => {
        const s = await readState(id);
        return s !== null && (s.membership?.status === 'active') === active;
    }, { description: `membership ${active ? 'active' : 'gone'} on series of ${id}` });
}

/** Open night `i`; the assertion that follows waits for the signup area. */
async function openNight(page: Page, i: number): Promise<void> {
    await page.goto(`/events/${night(i)}`);
}

test.describe('Series signup — join, skip a night, leave (ROK-1728)', () => {
    test('join from night 1, skip night 2, roster badge on night 3, leave the series', async ({ page }) => {
        test.setTimeout(120_000);

        await openNight(page, 0);
        await page.getByTestId('join-series-button').click();
        await expect(page.getByText(`${NIGHTS} upcoming nights`), 'the overlay counts every future night').toBeVisible();
        await page.getByTestId('join-series-confirm').click();
        await expect(page.getByTestId('series-member-actions')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('In for the series')).toBeVisible();
        await expectMembership(true);

        await openNight(page, 2);
        await expect(page.getByTestId('series-member-actions')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator(ROSTER_BADGE).first(), 'the roster marks a series member').toBeVisible({ timeout: 15_000 });

        await openNight(page, 1);
        await page.getByTestId('skip-this-night').click();
        await expect(page.getByTestId('series-skipped-night')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: SIGN_UP })).toBeVisible();

        await openNight(page, 2);
        await expect(page.getByTestId('series-member-actions'), 'skipping night 2 keeps night 3').toBeVisible({ timeout: 15_000 });

        await openNight(page, 0);
        await page.getByTestId('leave-series').click();
        await page.getByTestId('leave-series-confirm').click();
        await expect(page.getByRole('button', { name: SIGN_UP }), 'Leave series takes night 1 off').toBeVisible({ timeout: 15_000 });
        await expectMembership(false);

        // Leave declines every night, so joinableCount is 0 and Join series stays hidden (JoinSeriesButton).
        await openNight(page, 2);
        await expect(page.getByRole('button', { name: SIGN_UP }), 'Leave series takes later nights off too').toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('series-member-actions')).toHaveCount(0);
        await expect(page.locator(ROSTER_BADGE)).toHaveCount(0);
    });
});
