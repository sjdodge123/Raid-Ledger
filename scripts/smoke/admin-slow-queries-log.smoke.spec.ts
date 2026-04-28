/**
 * Admin Slow Queries log file smoke test (ROK-1156).
 *
 * Verifies the hourly slow-query digest cron writes `slow-queries.log` and
 * that it surfaces in the admin Logs panel as the `slow-queries` service.
 * Triggers the cron synchronously via the admin Cron Jobs API so the test
 * does not depend on the natural hourly cadence.
 *
 * Both desktop + mobile viewports are exercised through Playwright's project
 * matrix — CLAUDE.md mandates `npx playwright test` (no --project flag).
 */
import { test, expect } from './base';
import { apiGet, apiPost, getAdminToken } from './api-helpers';

const SLOW_QUERIES_CRON = 'SlowQueriesCron_appendDigest';

test.describe('Admin Slow Queries log surfacing', () => {
    test.beforeEach(async () => {
        // Resolve the cron's id and trigger it synchronously so a fresh
        // slow-queries.log block exists before we assert against the panel.
        const token = await getAdminToken();
        const crons = (await apiGet(token, '/admin/cron-jobs')) as Array<{
            id: number;
            name: string;
        }> | null;
        expect(crons, 'GET /admin/cron-jobs returned non-OK').toBeTruthy();
        const cron = crons!.find((c) => c.name === SLOW_QUERIES_CRON);
        expect(
            cron,
            `${SLOW_QUERIES_CRON} should be registered in CORE_JOB_METADATA`,
        ).toBeTruthy();
        const triggered = await apiPost(token, `/admin/cron-jobs/${cron!.id}/run`);
        expect(triggered, 'POST /admin/cron-jobs/{id}/run returned non-OK').toBeTruthy();
    });

    test('slow-queries.log appears in /admin/logs with the correct service badge', async ({ page }) => {
        await page.goto('/admin/settings/general/logs');

        await expect(
            page.getByRole('heading', { name: 'Container Logs' }),
        ).toBeVisible({ timeout: 15_000 });

        // The cron just appended a digest — the file row must surface in the
        // table. The cell wraps the filename in nested elements, so target by
        // role + name rather than text content.
        const slowQueryCell = page.getByRole('cell', { name: 'slow-queries.log' });
        await expect(slowQueryCell).toBeVisible({ timeout: 10_000 });

        // The new "slow-queries" filter pill renders once any file of that
        // service exists. Other pills (api, postgresql, etc.) may or may not
        // appear depending on dev env state, so we only assert ours.
        const slowQueriesPill = page.getByRole('button', { name: /^slow-queries \(\d+\)$/ });
        await expect(slowQueriesPill).toBeVisible({ timeout: 5_000 });

        // Filter narrows to slow-queries only — api.log etc. should disappear.
        await slowQueriesPill.click();
        await expect(slowQueryCell).toBeVisible();
        await expect(page.getByRole('cell', { name: 'api.log' })).toHaveCount(0);
    });

    test('no error boundary on load', async ({ page }) => {
        await page.goto('/admin/settings/general/logs');
        await expect(
            page.getByRole('heading', { name: 'Container Logs' }),
        ).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i);
    });
});
