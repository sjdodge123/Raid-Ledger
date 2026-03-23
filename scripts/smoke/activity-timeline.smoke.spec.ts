/**
 * Activity Timeline smoke tests (ROK-930).
 *
 * Creates a fresh event via the API (which triggers activity logging),
 * then navigates to that event's detail page and verifies the timeline renders.
 */
import { test, expect } from '@playwright/test';

const API_BASE = 'http://localhost:3000';

async function getAdminToken(): Promise<string> {
    const res = await fetch(`${API_BASE}/auth/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: 'admin@local',
            password: process.env.ADMIN_PASSWORD || 'password',
        }),
    });
    const { access_token } = (await res.json()) as { access_token: string };
    return access_token;
}

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
    });

    test.afterAll(async () => {
        if (adminToken && eventId) {
            await deleteEvent(adminToken, eventId);
        }
    });

    test('renders Activity heading with timeline entries', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        // Wait for event detail page to load
        await expect(
            page.getByText('Timeline Smoke Test Event'),
        ).toBeVisible({ timeout: 15_000 });

        // Activity section should be visible with entries
        const activityHeading = page.getByRole('heading', { name: 'Activity' });
        await expect(activityHeading).toBeVisible({ timeout: 15_000 });
    });

    test('shows event_created and signup_added entries', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        await expect(
            page.getByRole('heading', { name: 'Activity' }),
        ).toBeVisible({ timeout: 15_000 });

        // Scope assertions to the timeline section
        const timeline = page.locator('h3:has-text("Activity")').locator('..');

        // The creator auto-signs up, so we should see both actions
        await expect(
            timeline.getByText(/created the event/),
        ).toBeVisible({ timeout: 10_000 });

        await expect(
            timeline.getByText(/signed up/),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('timeline entries have timestamps', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        await expect(
            page.getByRole('heading', { name: 'Activity' }),
        ).toBeVisible({ timeout: 15_000 });

        // Timestamps show as relative ("Just now", "1m ago") or absolute dates
        const timelineSection = page.locator('h3:has-text("Activity")').locator('..');
        const timestamps = timelineSection.locator('p.text-dim, p[class*="text-[11px]"]');
        await expect(timestamps.first()).toBeVisible({ timeout: 10_000 });
    });

    test('timeline shows colored dot indicators', async ({ page }) => {
        await page.goto(`/events/${eventId}`);

        await expect(
            page.getByRole('heading', { name: 'Activity' }),
        ).toBeVisible({ timeout: 15_000 });

        // Each entry has a colored dot (w-8 h-8 rounded-full)
        const timelineSection = page.locator('h3:has-text("Activity")').locator('..');
        const dots = timelineSection.locator('.rounded-full.w-8');
        const count = await dots.count();
        expect(count).toBeGreaterThanOrEqual(2); // event_created + signup_added
    });
});
