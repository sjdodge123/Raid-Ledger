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
import { resolveApiUrl, resolveWebUrl } from './smoke/target';
import { browserSetupHint } from './smoke/browser-preflight';

// ROK-1234 follow-up: `bootstrap-admin.ts --reset-password` rotates the admin
// password and writes it back to the project root `.env`. Load that file here
// so `npx playwright test` Just Works after a password rotation, instead of
// silently falling back to the legacy 'password' default and 401-ing.
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ROK-1466: resolved through the shared helper so a fleet run that sets
// only PLAYWRIGHT_BASE_URL (Playwright's own convention, honoured by
// playwright.config.ts) does not silently authenticate against a
// localhost:3000 that has no listener inside a runner container.
const API_BASE = resolveApiUrl();
const BASE_URL = resolveWebUrl();
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

/**
 * Launch a browser, or rethrow with an actionable message on image drift.
 *
 * @returns A launched Chromium instance.
 */
async function launchBrowser() {
    try {
        return await chromium.launch();
    } catch (err) {
        const hint = browserSetupHint(err);
        if (hint) throw new Error(`[global-setup] ${hint}`);
        throw err;
    }
}

export default async function globalSetup(_config: FullConfig) {
    // ROK-1466: log unconditionally. Every message in this file used to be a
    // console.warn on a failure branch, so a run where setup did NOT execute
    // and a run where it executed cleanly produced byte-identical output —
    // which is exactly the ambiguity that stalled the first fleet spike. These
    // two lines make "did global setup run, and against what?" answerable from
    // the log head alone.
    console.log(
        `[global-setup] starting — web=${BASE_URL} api=${API_BASE} cwd=${process.cwd()}`,
    );
    console.log(`[global-setup] storageState target: ${STORAGE_STATE_PATH}`);

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
    console.log('[global-setup] authenticated admin@local');
    // The token file is written at the END, next to the storageState it must
    // agree with. Writing it here meant a crash at chromium.launch left a
    // token on disk with NO storageState — the next run's workers then read a
    // stale token, aged past the 50-min TTL, fell through to a live login, and
    // stormed the env's rate limiter (ROK-1466 fleet spike, attempts 2-3).

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
    const browser = await launchBrowser();
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

    // Sentinel: `use.storageState` reads this exact path, and a miss surfaces
    // per-test as "Error reading storage state from ...: ENOENT" — an error
    // that names the tests rather than the setup that owed them the file.
    // Fail HERE, where the resolved path and cwd are in scope.
    if (!fs.existsSync(STORAGE_STATE_PATH)) {
        throw new Error(
            `[global-setup] storageState was not written to ${STORAGE_STATE_PATH} ` +
                `(cwd=${process.cwd()}). Playwright's use.storageState reads the same ` +
                'constant from scripts/auth-paths.ts, so this means the write itself failed.',
        );
    }

    // Only now publish the token file, so admin-token.json and admin.json are
    // always from the same login — never one without the other.
    fs.writeFileSync(
        TOKEN_FILE_PATH,
        JSON.stringify({ access_token, issued_at: new Date().toISOString() }),
    );
    console.log(`[global-setup] done — storageState + token written to ${AUTH_DIR}`);
}
