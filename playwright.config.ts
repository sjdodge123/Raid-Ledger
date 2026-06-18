import { defineConfig, devices } from '@playwright/test';
import path from 'path';

/**
 * Playwright configuration for UI smoke tests (ROK-653, ROK-913)
 *
 * Usage:
 *   npx playwright test                    # Run all tests
 *   npx playwright test --ui               # Interactive UI mode
 *   npx playwright test --reporter=list    # Simple list output
 *
 * Requires:
 *   - API running on :3000 with demo data seeded
 *   - Web running on :5173 (auto-started locally via webServer below)
 *
 * Target URL precedence (mirrors scripts/validate-ci.sh::check_env_up):
 *   1. BASE_URL              — set by rl_validate_ci / `rl` CLI for fleet runs
 *   2. PLAYWRIGHT_BASE_URL   — Playwright's own convention; honored for parity
 *   3. http://localhost:5173 — default local-dev target
 *
 * webServer auto-launch is skipped when either fleet-mode env var is set so
 * Playwright does NOT try to spawn `npm run dev -w web` against a remote
 * deployment (the spawn would time out after 120s and dump misleading errors).
 */
const TARGET_BASE_URL =
    process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';
const IS_REMOTE_TARGET = Boolean(process.env.BASE_URL || process.env.PLAYWRIGHT_BASE_URL);

export default defineConfig({
    testDir: './scripts/smoke',
    testMatch: /\.smoke\.spec\.ts$/,

    /* Global setup: authenticate admin and save storageState */
    globalSetup: path.resolve('scripts/playwright-global-setup.ts'),

    /* Run tests sequentially — smoke tests share auth state */
    fullyParallel: false,

    /* Fail the build on CI if you accidentally left test.only in the source code */
    forbidOnly: !!process.env.CI,

    /* Retry to absorb cold-start / async-refetch timing flakes.
     * CI keeps 2 retries; local gets 1 as a safety net so a single
     * resource-contention blip on an overloaded laptop doesn't fail an
     * otherwise-deterministic spec (the deterministic waits added in the
     * specs are the primary fix — this retry only absorbs residual jitter). */
    retries: process.env.CI ? 2 : 1,

    /* Max time per test (and per hook). Local gets 2x headroom: the full
     * desktop+mobile run serves BOTH projects from one local API, so the
     * heavy API-setup beforeAll hooks (tiebreaker fixtures) contend and can
     * exceed 30s. CI shards across runners (no contention) so it keeps 30s. */
    timeout: process.env.CI ? 30_000 : 60_000,

    /* Default expect timeout. CI runners are slower (25s); local default was
     * 5s, too tight under full-suite load — bump to 10s so assertions without
     * an explicit timeout don't flake on a contended laptop. */
    expect: {
        timeout: process.env.CI ? 25_000 : 10_000,
    },

    /* Reporter to use */
    reporter: process.env.CI ? 'github' : 'list',

    /* Shared settings for all the projects below */
    use: {
        baseURL: TARGET_BASE_URL,

        /* Reuse authenticated state from global setup */
        storageState: path.resolve('scripts/.auth/admin.json'),

        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',

        /* Screenshot on failure */
        screenshot: 'only-on-failure',
    },

    /* Auto-start dev server when running locally.
     * When BASE_URL or PLAYWRIGHT_BASE_URL is set (e.g. running against a fleet
     * env URL like https://slot-1.gamernight.net), skip the webServer block
     * entirely — the app is already deployed somewhere else, no Vite to spin
     * up. */
    webServer: IS_REMOTE_TARGET
        ? undefined
        : {
              command: 'npm run dev -w web',
              url: 'http://localhost:5173',
              reuseExistingServer: true,
              timeout: 120_000,
          },

    /* Configure projects for desktop and mobile viewports */
    projects: [
        {
            name: 'desktop',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'mobile',
            use: { ...devices['Pixel 5'] },
        },
    ],
});
