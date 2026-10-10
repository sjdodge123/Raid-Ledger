/**
 * ROK-1203 light-mode theme audit: REPORT-ONLY axe `color-contrast` sweep.
 * Spec: planning-artifacts/specs/ROK-1203.md. Never gates CI: the default
 * Playwright config only matches `*.smoke.spec.ts`, the root vitest only
 * `*.spec.ts`, scope-specs.sh only `*.smoke.spec.ts`, and every test here is
 * skipped unless CONTRAST_AUDIT=1.
 *
 * Run it on the fleet (never the laptop): claim a slot, deploy the branch env
 * and take its slot `url`, then through `rl_run_on_runner` (timeout > 120 s
 * dispatches a VM task; poll `rl_task_status`):
 *
 *   CONTRAST_AUDIT=1 BASE_URL=<slot url> npx playwright test -c scripts/smoke/contrast-audit.config.ts \
 *     --project=desktop --workers=2; node scripts/smoke/contrast-audit.aggregate.mjs
 *
 * and `cat test-results/contrast-audit/REPORT.md` back (runner files are lost).
 *
 * Matrix: every route in contrast-audit.routes.ts x {default-dark,
 * default-light, celestial} x {desktop 1280x800, phone 375x812}; phone runs
 * under the desktop project (desktop UA) because breakpoints are width-driven.
 * Each cell signs in as the smoke admin (global-setup storageState; signed-out
 * routes get a fresh context), pins the scheme the way light-contrast does,
 * asserts `<html data-scheme>` before scanning (never scans the wrong theme),
 * settles within a 20 s budget (else `timeout`), scans the whole page and
 * appends one record to `test-results/contrast-audit/<scheme>-<viewport>.jsonl`.
 * Nothing asserts on violations: a cell only records what it found.
 */
import type { Browser, Page } from '@playwright/test';
import { test } from './base';
import { getAdminToken } from './api-helpers';
import {
    expectLightScheme,
    gotoWithPinnedPreferences,
    releaseLightScheme,
    useDarkScheme,
    useLightScheme,
    waitForFiniteAnimations,
} from './axe-contrast';
import { AUDIT_ROUTES, SKIPPED_ROUTES, fillPath, routeLabel, type AuditRoute, type RouteParams } from './contrast-audit.routes';
import {
    SCHEMES, VIEWPORTS, appendRecord, scanContrast,
    type AuditRecord, type AuditScheme, type AuditViewport,
} from './contrast-audit.record';

test.skip(!process.env['CONTRAST_AUDIT'], 'report-only sweep (ROK-1203): set CONTRAST_AUDIT=1');

/** Load + scheme check + settle must finish inside this, or the cell records `timeout`. */
const LOAD_BUDGET_MS = 20_000;
const SCHEME_NOT_APPLIED = 'scheme-not-applied';

type Outcome = Pick<AuditRecord, 'status' | 'reason'>;

/** One resolver call per route per worker. */
const resolved = new Map<string, Promise<RouteParams | string>>();

function resolveOnce(route: AuditRoute): Promise<RouteParams | string> {
    const resolve = route.resolve;
    if (!resolve) return Promise.resolve({});
    const cached = resolved.get(route.path) ?? getAdminToken().then((token) => resolve(token));
    resolved.set(route.path, cached);
    return cached;
}

/** No visible busy region or skeleton (runs in the page). */
function noBusyIndicators(): boolean {
    const busy = document.querySelectorAll('[aria-busy="true"], [data-testid*="skeleton" i]');
    return [...busy].every((el) => (el as HTMLElement).offsetParent === null);
}

async function expectScheme(page: Page, scheme: AuditScheme): Promise<void> {
    await expectLightScheme(page, scheme.dataScheme).catch((cause: unknown) => {
        throw new Error(`${SCHEME_NOT_APPLIED}: wanted data-scheme="${scheme.dataScheme}"`, { cause });
    });
}

/** Navigate and settle inside LOAD_BUDGET_MS; null when ready to scan. */
async function loadAndSettle(page: Page, route: AuditRoute, scheme: AuditScheme, url: string): Promise<Outcome | null> {
    const deadline = Date.now() + LOAD_BUDGET_MS;
    const left = (): number => Math.max(500, deadline - Date.now());
    try {
        page.setDefaultNavigationTimeout(left());
        if (route.auth === 'admin') await gotoWithPinnedPreferences(page, url, scheme.id, left());
        else await page.goto(url);
        await expectScheme(page, scheme);
        // Pages with polling never reach networkidle; the busy/skeleton wait below is the real gate.
        await page.waitForLoadState('networkidle', { timeout: Math.min(left(), 8_000) }).catch(() => undefined);
        await page.waitForFunction(noBusyIndicators, undefined, { timeout: left() });
        page.setDefaultTimeout(left());
        await waitForFiniteAnimations(page);
        await expectScheme(page, scheme);
        return null;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith(SCHEME_NOT_APPLIED)) return { status: 'error', reason: message };
        if (Date.now() >= deadline - 500) return { status: 'timeout', reason: `load/settle exceeded ${LOAD_BUDGET_MS / 1000}s` };
        return { status: 'error', reason: message.split('\n')[0]?.slice(0, 200) ?? 'unknown error' };
    }
}

async function runCell(page: Page, route: AuditRoute, scheme: AuditScheme, vp: AuditViewport): Promise<AuditRecord> {
    const base = { route: routeLabel(route), scheme: scheme.id, viewport: vp.name, violations: [], needsReview: [] };
    const params = await resolveOnce(route);
    if (typeof params === 'string') return { ...base, status: 'skipped', reason: params };
    const url = fillPath(route.path, params);
    const failed = await loadAndSettle(page, route, scheme, url);
    if (failed) return { ...base, url, ...failed };
    const scan = await scanContrast(page);
    const finalUrl = new URL(page.url()).pathname;
    return { ...base, ...scan, url, finalUrl, status: finalUrl === url ? 'ok' : 'redirect' };
}

/** runCell, with any throw turned into an `error` record (report-only: never fail the test). */
async function recordCell(page: Page, route: AuditRoute, scheme: AuditScheme, vp: AuditViewport): Promise<void> {
    try {
        appendRecord(await runCell(page, route, scheme, vp));
    } catch (error: unknown) {
        const reason = (error instanceof Error ? error.message : String(error)).split('\n')[0]?.slice(0, 200) ?? '';
        appendRecord({ route: routeLabel(route), scheme: scheme.id, viewport: vp.name, status: 'error', reason, violations: [], needsReview: [] });
    }
}

async function signedOutPage(browser: Browser): Promise<Page> {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    return context.newPage();
}

test('skipped routes are recorded with their reason', () => {
    for (const { path, reason } of SKIPPED_ROUTES) {
        appendRecord({ route: path, scheme: 'all', viewport: 'all', status: 'skipped', reason, violations: [], needsReview: [] });
    }
});

for (const route of AUDIT_ROUTES) {
    for (const scheme of SCHEMES) {
        for (const vp of VIEWPORTS) {
            test(`${routeLabel(route)} | ${scheme.id} | ${vp.name}`, async ({ page, browser }) => {
                const target = route.auth === 'none' ? await signedOutPage(browser) : page;
                try {
                    await target.setViewportSize({ width: vp.width, height: vp.height });
                    await (scheme.mode === 'dark' ? useDarkScheme(target, scheme.id) : useLightScheme(target, scheme.id));
                    await recordCell(target, route, scheme, vp);
                } finally {
                    await releaseLightScheme(target);
                    if (target !== page) await target.context().close();
                }
            });
        }
    }
}
