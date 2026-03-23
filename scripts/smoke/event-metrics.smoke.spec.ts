/**
 * Event metrics smoke tests — attendance summary, roster breakdown,
 * donut chart rendering, and back-navigation to event detail.
 *
 * Runs at both desktop (1280x720) and mobile (375x812) viewports via
 * Playwright projects. No viewport-specific selectors needed — the metrics
 * page uses responsive CSS that renders the same content at both sizes.
 */
import { test, expect, type TestInfo } from '@playwright/test';

function isMobile(testInfo: TestInfo) { return testInfo.project.name === 'mobile'; }

const API_BASE = process.env.API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

interface PastEvent { id: number; title: string }

async function findPastEventId(token: string): Promise<PastEvent | null> {
    const res = await fetch(`${API_BASE}/events?status=completed&limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    type ApiResponse = { data?: PastEvent[] } | PastEvent[];
    const data = (await res.json()) as ApiResponse;
    const events = Array.isArray(data) ? data : data.data ?? [];
    return events[0] ?? null;
}

// ---------------------------------------------------------------------------
// Event Metrics
// ---------------------------------------------------------------------------

test.describe('Event metrics', () => {
    let pastEvent: PastEvent;

    test.beforeAll(async () => {
        const token = await getAdminToken();
        const ev = await findPastEventId(token);
        if (!ev) throw new Error('No past event in demo data');
        pastEvent = ev;
    });

    test('page renders attendance summary for a past event', async ({ page }) => {
        await page.goto(`/events/${pastEvent.id}/metrics`);

        // Header renders with event title and back-link
        await expect(page.getByText(pastEvent.title)).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText(/back to event/i)).toBeVisible();

        // Attendance Summary section renders
        await expect(
            page.getByRole('heading', { name: 'Attendance Summary' }),
        ).toBeVisible();

        // Summary always shows "Total: N signups" for past events with roster data
        await expect(page.getByText(/total:.*signups/i)).toBeVisible();
    });

    test('roster breakdown table is visible', async ({ page }, testInfo) => {
        await page.goto(`/events/${pastEvent.id}/metrics`);

        await expect(
            page.getByRole('heading', { name: 'Roster Breakdown' }),
        ).toBeVisible({ timeout: 15_000 });

        // Table renders sortable column headers (may scroll off on mobile)
        if (isMobile(testInfo)) {
            await expect(page.getByText('Player').first()).toBeAttached();
        } else {
            await expect(page.getByText('Player').first()).toBeVisible();
            await expect(page.getByRole('columnheader', { name: 'Attendance' })).toBeVisible();
        }
    });

    test('donut chart renders without crashing', async ({ page }) => {
        await page.goto(`/events/${pastEvent.id}/metrics`);

        await expect(
            page.getByRole('heading', { name: 'Attendance Summary' }),
        ).toBeVisible({ timeout: 15_000 });

        // The donut chart displays an attendance percentage with "attended" label
        await expect(page.getByText('attended', { exact: true })).toBeVisible();

        // No error boundary triggered
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('back to event link navigates to event detail', async ({ page }) => {
        await page.goto(`/events/${pastEvent.id}/metrics`);

        await expect(page.getByText(/back to event/i)).toBeVisible({ timeout: 15_000 });

        await page.getByText(/back to event/i).click();
        await page.waitForURL(`/events/${pastEvent.id}`, { timeout: 10_000 });

        // Verify we landed on the event detail page (not an error)
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});
