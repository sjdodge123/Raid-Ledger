/**
 * Playwright config for the ROK-1203 report-only contrast sweep. The default
 * config's testMatch (`*.smoke.spec.ts`) never sees contrast-audit.report.pw.ts,
 * and the root vitest only picks `*.spec.ts`, so the sweep runs ONLY through
 * this file: `npx playwright test -c scripts/smoke/contrast-audit.config.ts`.
 * Everything else (global-setup login, storageState, projects, base URL) is
 * inherited from playwright.config.ts.
 */
import { defineConfig } from '@playwright/test';
import path from 'path';
import base from '../../playwright.config';
import { AUDIT_DIR } from './contrast-audit.record';

export default defineConfig({
    ...base,
    testDir: path.resolve('scripts/smoke'),
    testMatch: /contrast-audit\.report\.pw\.ts$/,
    /* The JSONL lands here; Playwright empties outputDir at run start, so a run never appends to the last one. */
    outputDir: AUDIT_DIR,
    /* Cells are independent; --workers=2 only helps when tests in one file may run in parallel. */
    fullyParallel: true,
    /* A retried cell would append its record twice. */
    retries: 0,
    /* axe walks every text node; /games renders hundreds of cards (the light-contrast gate uses 90 s too). */
    timeout: 90_000,
    /* Bounds expectLightScheme's data-scheme check inside the 20 s per-route load budget. */
    expect: { timeout: 5_000 },
    reporter: 'list',
});
