/**
 * Admin Slow Queries log file smoke test (ROK-1156, fixture refresh ROK-1070).
 *
 * Verifies that `slow-queries.log` surfaces in the admin Logs panel as the
 * `slow-queries` service. The fixture seeds a deterministic digest block via
 * `/admin/test/seed-slow-queries-log` so the panel assertions don't depend on
 * `pg_stat_statements` or `/data/logs` permissions in local dev. The hourly
 * cron path itself is exercised by api/src/slow-queries/*.spec.ts.
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
async function waitForSlowQueryFile(token: string, timeoutMs = 15_000) {
    const start = Date.now();
    let lastFiles: string[] = [];
    while (Date.now() - start < timeoutMs) {
        const res = (await apiGet(token, '/admin/logs')) as LogListResponse | null;
        if (res?.files.some((f) => f.service === 'slow-queries')) return;
        if (res?.files) lastFiles = res.files.map((f) => `${f.service}:${f.filename}`);
        await new Promise((r) => setTimeout(r, 250));
    }
    // Stay well inside Playwright's 30s beforeEach hook timeout so the
    // diagnostic actually flushes to stdout before Playwright kills the
    // worker. Without console.error here, the throw is invisible — Playwright
    // only reports the hook timeout.
    const crons = (await apiGet(token, '/admin/cron-jobs')) as CronJob[] | null;
    const cron = crons?.find((c) => c.name === SLOW_QUERIES_CRON);
    const diagnostic =
        `[ROK-1156 smoke] slow-queries log did not appear in /admin/logs within ${timeoutMs}ms.\n` +
        `  Files seen: [${lastFiles.join(', ') || '(none)'}]\n` +
        `  Cron lastStatus=${cron?.lastStatus} lastRunAt=${cron?.lastRunAt} lastError=${cron?.lastError ?? '(null)'}`;
    console.error(diagnostic);
    throw new Error(diagnostic);
}

test.describe('Admin Slow Queries log surfacing', () => {
    test.beforeEach(async () => {
        // ROK-1070: Use the deterministic seed-slow-queries-log endpoint
        // instead of triggering the cron. The cron path depends on
        // pg_stat_statements + writable LOG_DIR, both of which are flaky in
        // local dev / mac (LOG_DIR defaults to /data/logs which the nestjs
        // user can't mkdir). The seed endpoint creates the log dir
        // recursively and writes a deterministic single-line digest block,
        // which is sufficient for the panel assertions below. The original
        // cron path stays exercised by api/src/slow-queries/*.spec.ts.
        const token = await getAdminToken();
        const seeded = await apiPost(token, '/admin/test/seed-slow-queries-log', {});
        expect(seeded, 'POST /admin/test/seed-slow-queries-log returned non-OK').toBeTruthy();
        // Poll the API until the file is observable — the file write is
        // synchronous from the endpoint's perspective but the listing endpoint
        // may not see it for a tick on slower CI runners.
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
