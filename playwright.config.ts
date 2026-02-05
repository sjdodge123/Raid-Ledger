import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for UI verification (ROK-162)
 * 
 * Usage:
 *   npx playwright test                    # Run all tests
 *   npx playwright test --ui               # Interactive UI mode
 *   npx playwright test --reporter=list    # Simple list output
 */
export default defineConfig({
    testDir: './scripts',
    testMatch: /verify-ui\.spec\.ts$/,

    /* Run tests in parallel */
    fullyParallel: false, // Sequential for UI verification

    /* Fail the build on CI if you accidentally left test.only in the source code */
    forbidOnly: !!process.env.CI,

    /* No retries for verification - we want to know immediately if something breaks */
    retries: 0,

    /* Max time per test */
    timeout: 30_000,

    /* Reporter to use */
    reporter: process.env.CI ? 'github' : 'list',

    /* Shared settings for all the projects below */
    use: {
        /* Base URL to use in actions like `await page.goto('/')` */
        /* Docker-first: default to port 80 (production container), override with BASE_URL for dev server */
        baseURL: process.env.BASE_URL || 'http://localhost:80',

        /* Collect trace when retrying the failed test */
        trace: 'on-first-retry',

        /* Screenshot on failure */
        screenshot: 'only-on-failure',
    },

    /* Configure projects for major browsers */
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
