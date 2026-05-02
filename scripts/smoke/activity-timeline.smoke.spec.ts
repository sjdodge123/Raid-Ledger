/**
 * Activity Timeline smoke tests (ROK-930).
 *
 * Creates a fresh event via the API (which triggers activity logging),
 * then navigates to that event's detail page and verifies the timeline renders.
 */
import { test, expect } from './base';
import { API_BASE, apiPost, getAdminToken } from './api-helpers';

async function createTestEvent(token: string): Promise<number> {
    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 90000000).toISOString();
    const res = await fetch(`${API_BASE}/events`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            title: 'Timeline Smoke Test Event',
            startTime: start,
            endTime: end,
        }),
    });
    const body = (await res.json()) as { id: number };
    return body.id;
}

async function deleteEvent(token: string, eventId: number) {
    await fetch(`${API_BASE}/events/${eventId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
    });
}

test.describe('Activity Timeline on event detail', () => {
    let adminToken: string;
    let eventId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        eventId = await createTestEvent(adminToken);
        // ROK-1070: createSingleFlow does NOT auto-signup the creator, so the
        // "signed up" timeline assertion below would fail deterministically.
        // Explicit signup; the activity_log row is committed before the
        // response returns (signups.service.ts ~line 100).
        await apiPost(adminToken, `/events/${eventId}/signups`, {});
    });

    test.afterAll(async () => {
        if (adminToken && eventId) {
            await deleteEvent(adminToken, eventId);
        }
    });

    test('renders Activity heading with timeline entries', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        // ROK-1147: scope to the heading — getByText also matches a
        // "you're already signed up for…" paragraph that contains the
        // event name, which triggers strict-mode collisions.
        await expect(
            page.getByRole('heading', { name: 'Timeline Smoke Test Event' }),
        ).toBeVisible({ timeout: 15_000 });

        // Activity section is a collapsible button "Activity · N events"
        const activityBtn = page.locator('button', { hasText: /Activity · \d+ event/ });
        await expect(activityBtn).toBeVisible({ timeout: 15_000 });
    });

    test('shows event_created and signup_added entries', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        // The Activity section is a collapsible button with text "Activity · N events"
        const activityBtn = page.locator('button', { hasText: /Activity · \d+ event/ });
        await expect(activityBtn).toBeVisible({ timeout: 15_000 });

        // Expand the timeline if collapsed
        const expanded = page.locator('.border-t.border-edge');
        if (!(await expanded.isVisible({ timeout: 2_000 }).catch(() => false))) {
            await activityBtn.click();
        }

        // The creator auto-signs up, so we should see both actions.
        // ROK-1070: scope to .first() — earlier specs (notifications/events/
        // plan-event/create-event) call reset-to-seed which re-seeds demo
        // events that already have "created the event" activity rows, so
        // the page can show 3+ matching elements and break strict mode.
        await expect(
            page.getByText(/created the event/).first(),
        ).toBeVisible({ timeout: 10_000 });

        // "signed up" may be below the maxVisible fold — check it's in the DOM
        await expect(
            page.getByText(/signed up/).first(),
        ).toBeAttached({ timeout: 10_000 });
    });

    test('timeline entries have timestamps', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        // The Activity section is a collapsible button
        const activityBtn = page.locator('button', { hasText: /Activity · \d+ event/ });
        await expect(activityBtn).toBeVisible({ timeout: 15_000 });

        // Expand the timeline if collapsed
        const expanded = page.locator('.border-t.border-edge');
        if (!(await expanded.isVisible({ timeout: 2_000 }).catch(() => false))) {
            await activityBtn.click();
        }

        // Timestamps show as relative ("Just now", "1m ago") or absolute dates
        const timestamps = page.locator('p[class*="text-[11px]"]');
        await expect(timestamps.first()).toBeVisible({ timeout: 10_000 });
    });

    test('timeline shows colored dot indicators', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        // The Activity section is a collapsible button
        const activityBtn = page.locator('button', { hasText: /Activity · \d+ event/ });
        await expect(activityBtn).toBeVisible({ timeout: 15_000 });

        // Expand the timeline if collapsed
        const expanded = page.locator('.border-t.border-edge');
        if (!(await expanded.isVisible({ timeout: 2_000 }).catch(() => false))) {
            await activityBtn.click();
        }

        // Each entry has a colored dot (w-8 h-8 rounded-full)
        const dots = page.locator('.rounded-full.w-8');
        const count = await dots.count();
        expect(count).toBeGreaterThanOrEqual(2); // event_created + signup_added
    });
});
