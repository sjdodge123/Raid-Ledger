/**
 * Playwright Global Setup (ROK-653, updated ROK-1186)
 *
 * Authenticates admin@local via the API and saves browser storageState
 * so all tests run as an authenticated admin user.
 *
 * CI sequence (handled in ci.yml):
 *   1. Run migrations
 *   2. Bootstrap admin with ADMIN_PASSWORD=playwright-ci-password
 *   3. Start API, wait for /system/status health check
 *   4. Authenticate via POST /auth/local → get JWT
 *   5. ROK-1186: hard-reset DB (wipe + reseed demo) via
 *      POST /admin/test/reset-to-seed — replaces the old
 *      /admin/settings/demo/install call so every Playwright run
 *      starts from a clean baseline (no stale ORBITALIS polls etc).
 *   6. Save storageState for Playwright tests
 */
import { chromium, type FullConfig } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ADMIN_EMAIL = 'admin@local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

const AUTH_DIR = path.resolve(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'admin.json');
// ROK-1085: workers in scripts/smoke read this file via getAdminToken() to
// avoid each one POSTing /auth/local in parallel (the rate limiter dropped
// requests and caused did-not-run flakes under full-suite parallel run).
const TOKEN_FILE_PATH = path.join(AUTH_DIR, 'admin-token.json');

export default async function globalSetup(_config: FullConfig) {
    // Ensure .auth directory exists
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    // 1. Authenticate via API to get JWT
    const loginRes = await fetch(`${API_BASE}/auth/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });

    if (!loginRes.ok) {
        const body = await loginRes.text();
        throw new Error(
            `Failed to authenticate admin@local (${loginRes.status}): ${body}`,
        );
    }

    const { access_token } = (await loginRes.json()) as { access_token: string };

    fs.writeFileSync(
        TOKEN_FILE_PATH,
        JSON.stringify({ access_token, issued_at: new Date().toISOString() }),
    );

    // 2. ROK-1186: Hard reset to demo seed baseline. Wipes any stale
    // test fixtures (orphan events, signups, lineups) left over from
    // previous runs and re-runs the demo installer. Replaces the
    // previous standalone demo/install call. Non-fatal — falls back
    // to demo/install if the reset endpoint isn't available yet
    // (covers branches that haven't deployed ROK-1186 in their API).
    const resetRes = await fetch(`${API_BASE}/admin/test/reset-to-seed`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${access_token}`,
        },
    });

    if (!resetRes.ok) {
        const body = await resetRes.text();
        console.warn(
            `Reset-to-seed returned ${resetRes.status}: ${body} — falling back to demo/install`,
        );
        const seedRes = await fetch(`${API_BASE}/admin/settings/demo/install`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${access_token}`,
            },
        });
        if (!seedRes.ok) {
            const seedBody = await seedRes.text();
            console.warn(`Demo data seed returned ${seedRes.status}: ${seedBody}`);
        }
    }

    // 3. Launch browser, set JWT in localStorage, save storageState
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the app so localStorage is associated with the correct origin
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    // Set the JWT token in localStorage (matching use-auth.ts TOKEN_KEY)
    await page.evaluate((token) => {
        localStorage.setItem('raid_ledger_token', token);
    }, access_token);

    // Save the authenticated state
    await context.storageState({ path: STORAGE_STATE_PATH });

    await browser.close();
}
