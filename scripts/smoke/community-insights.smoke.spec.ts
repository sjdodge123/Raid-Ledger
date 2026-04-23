/**
 * Community Insights dashboard smoke tests (ROK-1099).
 *
 * Covers the tabbed `/insights` hub introduced in Milestone 6 of the Taste
 * Profile epic:
 *   - Admin loads `/insights` → Community tab renders 5 `data-testid` panels
 *   - Events tab is navigable and shows dashboard content
 *   - Legacy `/event-metrics` redirects to `/insights/events`
 *   - `/events/:id/metrics` deep link still works
 *   - Header nav shows "Insights" (not "Event Metrics")
 *   - Social Graph exposes a "Show as table" accessible fallback toggle
 *   - Key Insights panel renders a list
 *
 * Runs at both desktop and mobile viewports via Playwright projects.
 * Written TDD-first — must fail until Phases A–D ship the implementation.
 */
import { test, expect } from './base';
import { API_BASE, getAdminToken } from './api-helpers';

interface EventSummary { id: number }

async function findAnyEventId(token: string): Promise<number | null> {
    const res = await fetch(`${API_BASE}/events?limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    type ApiResponse = { data?: EventSummary[] } | EventSummary[];
    const data = (await res.json()) as ApiResponse;
    const events = Array.isArray(data) ? data : data.data ?? [];
    return events[0]?.id ?? null;
}

test.describe('Community Insights dashboard', () => {
    test('admin loads /insights — Community tab renders all 5 panels', async ({ page }) => {
        await page.goto('/insights');

        // Hub container renders
        await expect(page.getByTestId('insights-hub')).toBeVisible({ timeout: 15_000 });

        // Community tab is the admin default — all 5 panels visible by testid
        await expect(page.getByTestId('community-insights-radar')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByTestId('community-insights-engagement')).toBeVisible();
        await expect(page.getByTestId('community-insights-social-graph')).toBeVisible();
        await expect(page.getByTestId('community-insights-temporal')).toBeVisible();
        await expect(page.getByTestId('community-insights-key-insights')).toBeVisible();

        // No error boundary crash
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('Events tab is navigable and shows dashboard content', async ({ page }) => {
        await page.goto('/insights/events');

        // Hub still mounted, but events tab content visible
        await expect(page.getByTestId('insights-hub')).toBeVisible({ timeout: 15_000 });

        // Must show at least one of the expected dashboard markers:
        // either the new "Event Metrics" heading OR the MyEventsPage dashboard heading.
        const eventMetricsHeading = page.getByRole('heading', { name: /Event Metrics/i });
        const dashboardHeading = page.getByRole('heading', { name: /Dashboard/i });
        await expect(eventMetricsHeading.or(dashboardHeading).first()).toBeVisible({ timeout: 15_000 });
    });

    test('legacy /event-metrics redirects to /insights/events', async ({ page }) => {
        await page.goto('/event-metrics');

        // Client redirect resolves — wait for URL to settle on /insights/events
        await page.waitForURL(/\/insights\/events$/, { timeout: 15_000 });
        expect(page.url()).toMatch(/\/insights\/events$/);
    });

    test('/events/:id/metrics deep link still works with Insights breadcrumb', async ({ page }) => {
        const token = await getAdminToken();
        const eventId = await findAnyEventId(token);
        if (!eventId) throw new Error('No events in demo data for deep-link test');

        await page.goto(`/events/${eventId}/metrics`);

        // URL is preserved (no redirect back into /insights)
        await expect(page).toHaveURL(new RegExp(`/events/${eventId}/metrics$`), { timeout: 15_000 });

        // Per-event metrics page still renders — look for the attendance summary
        // heading that's been on this page pre-ROK-1099.
        await expect(
            page.getByRole('heading', { name: 'Attendance Summary' }),
        ).toBeVisible({ timeout: 15_000 });

        // ROK-1099 adds a breadcrumb link back to /insights/events on the
        // per-event metrics page. Scope to <main> so it does not accidentally
        // match the renamed global "Insights" nav link.
        const main = page.locator('main');
        await expect(
            main.getByRole('link', { name: /(← |back to )?insights/i }).first(),
        ).toBeVisible({ timeout: 10_000 });

        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });

    test('nav shows "Insights" entry (not "Event Metrics")', async ({ page }) => {
        await page.goto('/insights');
        await expect(page.getByTestId('insights-hub')).toBeVisible({ timeout: 15_000 });

        // On mobile, the admin-gated "Insights" entry may live in the hamburger
        // drawer rather than the always-visible bottom tab bar, so assert the
        // link is attached to the DOM (not necessarily visible).
        await expect(
            page.getByRole('link', { name: /^Insights$/i }).first(),
        ).toBeAttached({ timeout: 10_000 });

        // Critical: the old label must not appear as a nav link anywhere.
        await expect(page.getByRole('link', { name: /^Event Metrics$/i })).toHaveCount(0);
    });

    test('Social Graph exposes an accessible "Show as table" fallback', async ({ page }) => {
        await page.goto('/insights');

        const socialGraph = page.getByTestId('community-insights-social-graph');
        await expect(socialGraph).toBeVisible({ timeout: 15_000 });

        // A11y fallback toggle must be present per AC 12 + architect guidance
        await expect(
            socialGraph.getByRole('button', { name: /show as table/i }),
        ).toBeVisible();
    });

    test('Key Insights panel renders a list of insights', async ({ page }) => {
        await page.goto('/insights');

        const keyInsights = page.getByTestId('community-insights-key-insights');
        await expect(keyInsights).toBeVisible({ timeout: 15_000 });

        // Bulleted list (<ul>/<ol> or role="list") with at least one item
        await expect(keyInsights.getByRole('list').first()).toBeVisible();
    });
});
