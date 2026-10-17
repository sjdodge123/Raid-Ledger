/**
 * Admin Settings — Update Banner smoke (ROK-1242).
 *
 * Seeds app_settings via the DEMO_MODE-only POST /admin/test/set-setting
 * endpoint so the cron's GitHub round-trip is bypassed, then verifies:
 *   - banner renders with both versions
 *   - link points at the seeded latest_release_url
 *   - dismiss writes the sessionStorage key and reload keeps the banner
 *     hidden for that version
 *
 * Runs on BOTH desktop and mobile projects (CLAUDE.md STRICT smoke rule).
 */
import { test, expect } from './base';
import { apiPost, getAdminToken } from './api-helpers';

const LATEST_VERSION = '999.0.0';
const RELEASE_URL =
    'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v999.0.0';

async function seedUpdateBannerState(): Promise<void> {
    const token = await getAdminToken();
    await Promise.all([
        apiPost(token, '/admin/test/set-setting', {
            key: 'latest_version',
            value: LATEST_VERSION,
        }),
        apiPost(token, '/admin/test/set-setting', {
            key: 'update_available',
            value: 'true',
        }),
        apiPost(token, '/admin/test/set-setting', {
            key: 'latest_release_url',
            value: RELEASE_URL,
        }),
        apiPost(token, '/admin/test/set-setting', {
            key: 'version_check_last_run',
            value: new Date().toISOString(),
        }),
    ]);
}

async function clearUpdateBannerState(): Promise<void> {
    const token = await getAdminToken();
    // value: null deletes the setting (see DemoTestGraceController.setSetting).
    await Promise.all([
        apiPost(token, '/admin/test/set-setting', {
            key: 'latest_version',
            value: null,
        }),
        apiPost(token, '/admin/test/set-setting', {
            key: 'update_available',
            value: null,
        }),
        apiPost(token, '/admin/test/set-setting', {
            key: 'latest_release_url',
            value: null,
        }),
        apiPost(token, '/admin/test/set-setting', {
            key: 'version_check_last_run',
            value: null,
        }),
    ]);
}

test.describe('Admin Settings — Update Banner (ROK-1242)', () => {
    test.beforeEach(async () => {
        await seedUpdateBannerState();
    });

    test.afterEach(async () => {
        await clearUpdateBannerState();
    });

    test('renders banner with versions and data-driven release link', async ({ page }) => {
        await page.goto('/admin/settings');

        const banner = page.getByRole('status').filter({ hasText: /A new version of Raid Ledger is available/ });
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await expect(banner).toContainText(`v${LATEST_VERSION}`);

        const link = banner.getByRole('link', { name: /View release notes/i });
        await expect(link).toHaveAttribute('href', RELEASE_URL);
        await expect(link).toHaveAttribute('target', '_blank');
    });

    test('dismiss persists across reload for the same version', async ({ page }) => {
        await page.goto('/admin/settings');

        const banner = page.getByRole('status').filter({ hasText: /A new version of Raid Ledger is available/ });
        await expect(banner).toBeVisible({ timeout: 15_000 });

        await banner.getByRole('button', { name: /Dismiss update banner/i }).click();
        await expect(banner).not.toBeVisible({ timeout: 5_000 });

        await page.reload();

        // Same version is still dismissed.
        await expect(
            page.getByText(/A new version of Raid Ledger is available/),
        ).toHaveCount(0, { timeout: 10_000 });
    });
});
