/**
 * ROK-2342 S3: a failed list query shows a retryable error state, never the
 * empty state. Forces the Events list endpoint to 500 via `page.route`, asserts
 * the error state (no "no events" copy), then lets the next request through and
 * proves "Try again" refetches and the error clears. Runs on desktop and mobile.
 */
import type { Route } from '@playwright/test';
import { test, expect } from './base';

/** The Events page's list call: `GET <api>/events?…page=…` (not the SPA document). */
function isEventsListCall(route: Route): boolean {
    const req = route.request();
    if (req.method() !== 'GET' || !['fetch', 'xhr'].includes(req.resourceType())) return false;
    const url = new URL(req.url());
    return url.pathname.endsWith('/events') && url.searchParams.has('page');
}

test('a failed events list shows the error state and Try again refetches', async ({ page }) => {
    let fail = true;
    let failedCalls = 0;
    await page.route((url) => url.pathname.endsWith('/events'), async (route) => {
        if (!isEventsListCall(route) || !fail) return route.fallback();
        failedCalls += 1;
        return route.fulfill({ status: 500, json: { statusCode: 500, message: 'Internal server error' } });
    });

    await page.goto('/events');
    const errorState = page.getByTestId('events-error');
    // The app's query client retries once, so allow for the backoff.
    await expect(errorState).toBeVisible({ timeout: 20_000 });
    await expect(errorState.getByRole('heading', { name: "Couldn't load events" })).toBeVisible();
    expect(failedCalls).toBeGreaterThan(0);
    // The raw message is tucked into a collapsed <details>, not the headline.
    await expect(errorState.getByText('Technical details')).toBeVisible();

    fail = false;
    await errorState.getByRole('button', { name: 'Try again' }).click();
    await expect(errorState).toBeHidden({ timeout: 15_000 });
});
