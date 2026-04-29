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

interface LogFileDto {
    filename: string;
    service: string;
}
interface LogListResponse {
    files: LogFileDto[];
}

interface CronJob {
    id: number;
    name: string;
    lastRunAt: string | null;
    lastDurationMs: number | null;
    lastStatus: string | null;
    lastError: string | null;
}

/**
 * Poll `/admin/logs` until a `service: 'slow-queries'` file is listed by the
 * API. Returns once the API has fully observed the cron's append; this
 * eliminates the race between the cron's `fs.appendFile` returning to the
 * trigger endpoint and the React Query fetch on the panel page (which has a
 * 15s staleTime — without this poll, an empty initial fetch can be served
 * for the lifetime of the test).
 *
 * On timeout, fetch the cron's recorded `lastStatus` / `lastError` and
 * include them in the failure message so CI logs surface the real reason
 * the file was never written (e.g., permissions on /data/logs, missing
 * pg_stat_statements extension in the test container).
 */
async function waitForSlowQueryFile(token: string, timeoutMs = 30_000) {
    const start = Date.now();
    let lastFiles: string[] = [];
    while (Date.now() - start < timeoutMs) {
        const res = (await apiGet(token, '/admin/logs')) as LogListResponse | null;
        if (res?.files.some((f) => f.service === 'slow-queries')) return;
        if (res?.files) lastFiles = res.files.map((f) => `${f.service}:${f.filename}`);
        await new Promise((r) => setTimeout(r, 250));
    }
    const crons = (await apiGet(token, '/admin/cron-jobs')) as CronJob[] | null;
    const cron = crons?.find((c) => c.name === SLOW_QUERIES_CRON);
    throw new Error(
        `slow-queries log did not appear in /admin/logs within ${timeoutMs}ms.\n` +
            `  Files seen: [${lastFiles.join(', ') || '(none)'}]\n` +
            `  Cron lastStatus=${cron?.lastStatus} lastRunAt=${cron?.lastRunAt} lastError=${cron?.lastError ?? '(null)'}`,
    );
}

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
        // Poll the API until the file is observable — the cron's write is
        // synchronous from its handler's perspective but the file may not be
        // listable for a tick or two on slower CI runners.
        await waitForSlowQueryFile(token);
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
        // service exists. Use a loose selector — the button label is
        // `{service} ({count})` and CI sometimes wraps the text differently
        // than local; matching by hasText avoids whitespace/anchor brittleness.
        const slowQueriesPill = page
            .getByRole('button')
            .filter({ hasText: /slow-queries/ });
        await expect(slowQueriesPill).toBeVisible({ timeout: 10_000 });

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
