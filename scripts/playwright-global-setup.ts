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
import dotenv from 'dotenv';
import { AUTH_DIR, STORAGE_STATE_PATH, TOKEN_FILE_PATH } from './auth-paths';

// ROK-1234 follow-up: `bootstrap-admin.ts --reset-password` rotates the admin
// password and writes it back to the project root `.env`. Load that file here
// so `npx playwright test` Just Works after a password rotation, instead of
// silently falling back to the legacy 'password' default and 401-ing.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const ADMIN_EMAIL = 'admin@local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'password';

/**
 * Best-effort, idempotent archive of lineups from a previous smoke run.
 * Scoped to the shared `smoke-w` worker-title prefix so it never touches
 * real/demo lineups. Swallows all failures (logs + continues) so a missing
 * DEMO_MODE endpoint or transient error can never crash global setup.
 */
async function archiveStaleSmokeLineups(
    apiBase: string,
    token: string,
): Promise<void> {
    try {
        const res = await fetch(`${apiBase}/admin/test/reset-lineups`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ titlePrefix: 'smoke-w' }),
        });
        if (!res.ok) {
            console.warn(
                `[global-setup] reset-lineups(smoke-w) → ${res.status} — continuing`,
            );
        }
    } catch (err) {
        console.warn(
            `[global-setup] reset-lineups(smoke-w) failed: ${String(err)} — continuing`,
        );
    }
}

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
        // ROK-1286 (FIX 4): a 403 here means the API is NOT in DEMO_MODE, so
        // every /admin/test/* reset endpoint is disabled. Call it out loudly —
        // the demo/install fallback below does NOT wipe lineups, so smoke
        // fixtures can otherwise inherit stale/absent state and flake. The real
        // fix is running smoke with DEMO_MODE=true in CI (see CI config).
        if (resetRes.status === 403) {
            console.warn(
                '[global-setup] reset-to-seed → 403: API is NOT running in DEMO_MODE; ' +
                    'test-only reset endpoints are disabled. Smoke state may be stale/absent. ' +
                    'Run smoke with DEMO_MODE=true. Falling back to demo/install.',
            );
        }
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

    // ROK-1286 (FIX 2): belt-and-suspenders archive of any lineups left behind
    // by a PREVIOUS smoke run (title prefix `smoke-w<idx>-…`). When reset-to-
    // seed succeeds above this is a no-op (all lineups are already wiped); but
    // when it 403s/falls back to demo/install (which does NOT wipe lineups) on
    // a persistent DB (e.g. the fleet), stale `smoke-w*` rows would otherwise
    // bleed across runs and hand `/lineups/banner` to a sibling's VOTING-phase
    // lineup — deterministically breaking the Nominate-button specs. Idempotent
    // and best-effort: a failure logs and continues so setup never crashes.
    await archiveStaleSmokeLineups(API_BASE, access_token);

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
