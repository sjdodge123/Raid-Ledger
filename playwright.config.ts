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
 */
export default defineConfig({
    testDir: './scripts/smoke',
    testMatch: /\.smoke\.spec\.ts$/,

    /* Global setup: authenticate admin and save storageState */
    globalSetup: path.resolve('scripts/playwright-global-setup.ts'),

    /* Run tests sequentially — smoke tests share auth state */
    fullyParallel: false,

    /* Fail the build on CI if you accidentally left test.only in the source code */
    forbidOnly: !!process.env.CI,

    /* Retry once on CI to absorb cold-start timing flakes */
    retries: process.env.CI ? 1 : 0,

    /* Max time per test */
    timeout: 30_000,

    /* Reporter to use */
    reporter: process.env.CI ? 'github' : 'list',

    /* Shared settings for all the projects below */
    use: {
        baseURL: process.env.BASE_URL || 'http://localhost:5173',

        /* Reuse authenticated state from global setup */
        storageState: path.resolve('scripts/.auth/admin.json'),

        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',

        /* Screenshot on failure */
        screenshot: 'only-on-failure',
    },

    /* Auto-start dev server when running locally */
    webServer: {
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
