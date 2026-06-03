/**
 * ROK-1323 — Strip legacy chrome from the lineup detail page (Cycle 4 cleanup).
 *
 * TDD gate (TDD_WRITE_FAILING): these assertions describe the POST-STRIP
 * page and therefore FAIL against current `main`, where the legacy
 * `LineupDetailHeader` chrome (title H1 block, status badge, 4-phase
 * breadcrumb, "Started by…" meta, Edit/Abort buttons, PublicShareRow) and
 * the `HeroNextStep` banner still render. The dev agent (Step 2e) removes
 * that chrome and wires the new operator `⋮` menu so these pass.
 *
 * AC 8 is the testable contract. One describe block per phase asserts the
 * legacy chrome is ABSENT and the JourneyHero ribbon is the sole phase
 * indicator; further blocks cover the operator `⋮` menu (present + opens for
 * an operator persona, hidden for a non-operator member), the member
 * copy-link affordance, the collapsed activity log, and the public
 * `/p/lineup/:slug` page (AC 7).
 *
 * NEW testids the dev MUST wire to the SAME ids (documented in the TDD
 * report):
 *   - `lineup-operator-menu-trigger`  → the `⋮` button
 *   - `lineup-operator-menu`          → the open dropdown container
 *   - `lineup-operator-menu-edit`     → Edit item
 *   - `lineup-operator-menu-advance`  → Advance item
 *   - `lineup-operator-menu-abort`    → Abort item
 *   - `lineup-share-copy`             → member-visible Copy-link affordance
 *
 * Existing testids asserted ABSENT after the strip:
 *   - `hero-next-step`            (HeroNextStep banner — AC 1)
 *   - `community-lineup-title`    (legacy H1 header block — AC 2/3)
 *
 * Runs under BOTH Playwright projects (desktop + mobile) per the ROK-935
 * rule; playwright.config.ts handles project fan-out.
 */
import { test, expect } from './base';
import type { Page } from '@playwright/test';
import {
    API_BASE,
    getAdminToken,
    getInviteeFixture,
    apiGet,
    apiPatch,
    apiPost,
    createLineupOrRetry,
    awaitProcessing,
} from './api-helpers';

// ROK-1147: per-worker title prefix scopes /admin/test/reset-lineups so
// sibling workers don't archive each other's lineups mid-test.
const FILE_PREFIX = 'lineup-chrome-strip';
let workerPrefix: string;
let lineupTitle: string;
let adminToken: string;

// Mobile parallel-worker contention can push the multi-call phase setup past
// Playwright's default 30s hook timeout under full-suite load.
const HOOK_TIMEOUT_MS = 90_000;

async function fetchGameIds(token: string, count: number): Promise<number[]> {
    const data = await apiGet(token, '/admin/settings/games');
    if (!data?.data?.length) {
        throw new Error('No games in DB — seed data missing');
    }
    return data.data.slice(0, count).map((g: { id: number }) => g.id);
}

/** Archive this worker's lineups (prefix-scoped, DEMO_MODE-only). */
async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

/**
 * Create a fresh `building` lineup for this worker, optionally
 * public-share-enabled, and walk it to `targetPhase`. Returns the id.
 *
 * The lineup state machine terminates at `decided` — `LineupStatusSchema`
 * (packages/contract/src/lineup.schema.ts) is building | voting | decided |
 * archived; there is NO `scheduling` status. Scheduling is a per-match route
 * (`/community-lineup/:id/schedule/:matchId`, ROK-1300's separate composite),
 * not a detail-page phase, so the detail-page walk stops at `decided`. AC 8's
 * "Scheduling" coverage is satisfied via the ribbon's Schedule step (see the
 * dedicated test below). `decided` needs a `decidedGameId`, so we seed
 * nominations first for any phase past building.
 */
async function setupLineupInPhase(
    token: string,
    targetPhase: 'building' | 'voting' | 'decided',
    opts: { publicShareEnabled?: boolean } = {},
): Promise<number> {
    await resetWorkerLineups(token);
    // The operator-menu Sharing section gates on `lineup.visibility !==
    // 'private'` (mirrors the legacy PublicShareRow — private lineups never
    // expose public-share). `CreateLineupSchema.visibility` is
    // `.default('public').optional()`: the Zod default()+optional() combo
    // yields `undefined` (NOT 'public') when the key is OMITTED, so a
    // publicShareEnabled lineup must ALSO send `visibility: 'public'`
    // explicitly or the Sharing section is (correctly) hidden.
    const { id } = await createLineupOrRetry(
        token,
        {
            title: lineupTitle,
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
            matchThreshold: 10,
            ...(opts.publicShareEnabled
                ? { publicShareEnabled: true, visibility: 'public' }
                : {}),
        },
        workerPrefix,
    );

    if (targetPhase !== 'building') {
        // Seed nominations so voting/decided have data + a winner candidate.
        const gameIds = await fetchGameIds(token, 3);
        for (const gid of gameIds) {
            await apiPost(token, `/lineups/${id}/nominate`, { gameId: gid });
        }
    }

    const walk: Record<string, string[]> = {
        building: [],
        voting: ['voting'],
        decided: ['voting', 'decided'],
    };
    for (const status of walk[targetPhase]) {
        const body: Record<string, unknown> = { status };
        if (status === 'decided') {
            const detail = await apiGet(token, `/lineups/${id}`);
            if (detail?.entries?.length > 0) {
                body.decidedGameId = detail.entries[0].gameId;
            }
        }
        await apiPatch(token, `/lineups/${id}/status`, body);
    }
    await awaitProcessing(token);
    return id;
}

/**
 * Swap the browser session to the non-admin invitee fixture user by
 * overwriting `localStorage.raid_ledger_token` (matches use-auth.ts
 * TOKEN_KEY), mirroring lineup-confirmation-pills-invitee.smoke.spec.ts.
 */
async function loginInvitee(page: Page, token: string): Promise<void> {
    await page.goto('/');
    await page.evaluate((t) => {
        localStorage.setItem('raid_ledger_token', t);
    }, token);
}

/**
 * Assert that NONE of the legacy chrome elements render on the current page.
 * Shared across every phase block (AC 1, 2, 3, 8). The JourneyHero ribbon
 * (`aria-label="Lineup progress"`) must be the sole phase indicator.
 */
async function expectLegacyChromeAbsent(page: Page): Promise<void> {
    // AC 1 — top-level "NEXT… Advance to X" banner gone.
    await expect(page.getByTestId('hero-next-step')).toHaveCount(0);

    // AC 3 — legacy H1 title header block gone (title now lives in the hero).
    await expect(page.getByTestId('community-lineup-title')).toHaveCount(0);

    // AC 2 — 4-phase breadcrumb strip gone. The breadcrumb rendered the
    // PHASE_LABELS (lineup-phases.ts) as clickable buttons for operators:
    // building→"Nominating", voting→"Voting", decided→"Scheduling",
    // archived→"Archived". None of those phase buttons should remain.
    for (const label of ['Nominating', 'Voting', 'Scheduling', 'Archived']) {
        await expect(page.getByRole('button', { name: new RegExp(`^${label}$`) })).toHaveCount(0);
    }

    // AC 2 — the JourneyHero ribbon IS the canonical phase indicator and
    // must be present.
    await expect(page.getByRole('list', { name: 'Lineup progress' }).first()).toBeVisible({
        timeout: 15_000,
    });
}

test.beforeAll(async ({}, testInfo) => {
    test.setTimeout(HOOK_TIMEOUT_MS);
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Smoke Lineup`;
    adminToken = await getAdminToken();
});

// ---------------------------------------------------------------------------
// AC 1/2/3/8 — legacy chrome absent on every phase, hero ribbon canonical
// ---------------------------------------------------------------------------

test.describe('Legacy chrome stripped — per phase', () => {
    // The three real detail-page phases that ever carried the legacy chrome.
    // `scheduling` is NOT a lineup status (the state machine terminates at
    // `decided`) — its AC-8 coverage is the Schedule-ribbon-step test below.
    for (const phase of ['building', 'voting', 'decided'] as const) {
        test(`${phase}: legacy chrome absent, JourneyHero ribbon is sole phase indicator`, async ({
            page,
        }) => {
            test.setTimeout(HOOK_TIMEOUT_MS);
            const lineupId = await setupLineupInPhase(adminToken, phase);

            await page.goto(`/community-lineup/${lineupId}`);
            await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
                timeout: 10_000,
            });

            await expectLegacyChromeAbsent(page);
        });
    }

    test('scheduling indicator is the JourneyHero ribbon Schedule step (not detail chrome) — AC 8', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // AC 8 lists "Scheduling" among the phases that must show no legacy
        // chrome. There is no `scheduling` lineup status — the scheduling poll
        // is a SEPARATE per-match route/composite
        // (`/community-lineup/:id/schedule/:matchId`, ROK-1300) that never
        // carried this detail-page chrome. On the decided detail page, the
        // scheduling phase is represented by the JourneyHero ribbon's
        // "Schedule" step, which is the canonical indicator after the strip.
        const lineupId = await setupLineupInPhase(adminToken, 'decided');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
            timeout: 10_000,
        });

        // Legacy chrome still absent on the decided page (no breadcrumb to
        // carry a clickable "Scheduling" pill).
        await expectLegacyChromeAbsent(page);

        // The ribbon (`role=list` "Lineup progress") owns the Schedule step —
        // rendered as the 4th PhaseDot label in JourneyHero (PHASE_LABELS =
        // Nominate / Vote / Decide / Schedule). Its presence inside the ribbon
        // is the scheduling indicator.
        const ribbon = page.getByRole('list', { name: 'Lineup progress' }).first();
        await expect(ribbon).toBeVisible({ timeout: 15_000 });
        await expect(ribbon).toContainText(/Schedule/i, { timeout: 5_000 });
    });

    test('lineup title + "Started by…" meta render inside the composite hero (sub), not a header (AC 3)', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        const lineupId = await setupLineupInPhase(adminToken, 'building');

        await page.goto(`/community-lineup/${lineupId}`);

        // The JourneyHero region carries the title + creator meta. The legacy
        // separate H1 header block (`community-lineup-title`) is gone, so the
        // title text now lives inside the hero region.
        const hero = page.getByRole('region', { name: /.+/ }).filter({
            has: page.getByRole('list', { name: 'Lineup progress' }),
        });
        await expect(hero.first()).toBeVisible({ timeout: 15_000 });
        await expect(hero.first()).toContainText(lineupTitle, { timeout: 5_000 });
        await expect(hero.first()).toContainText(/Started by/i, { timeout: 5_000 });

        await expect(page.getByTestId('community-lineup-title')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC 4/5 — operator `⋮` menu (present + opens for operator persona)
// ---------------------------------------------------------------------------

test.describe('Operator ⋮ menu — operator persona', () => {
    test('menu present, opens, and exposes Edit / Advance / Abort + share toggle', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        // Public-share-enabled so the Sharing section (toggle + copy) renders.
        const lineupId = await setupLineupInPhase(adminToken, 'building', {
            publicShareEnabled: true,
        });

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
            timeout: 10_000,
        });

        // The `⋮` trigger is present for the operator/admin persona.
        const trigger = page.getByTestId('lineup-operator-menu-trigger');
        await expect(trigger).toBeVisible({ timeout: 15_000 });

        // Closed by default — the menu container is not yet rendered/visible.
        await expect(page.getByTestId('lineup-operator-menu')).toHaveCount(0);

        // Opens on click and items are reachable + accessibly named.
        await trigger.click();
        const menu = page.getByTestId('lineup-operator-menu');
        await expect(menu).toBeVisible({ timeout: 5_000 });

        await expect(menu.getByTestId('lineup-operator-menu-edit')).toBeVisible();
        await expect(menu.getByTestId('lineup-operator-menu-advance')).toBeVisible();
        await expect(menu.getByTestId('lineup-operator-menu-abort')).toBeVisible();

        // AC 5 — public-share toggle lives inside the menu's Sharing section.
        // The toggle renders as a `role="menuitem"` (explicit role overrides
        // the implicit button role) named "Public link On/Off".
        await expect(menu.getByRole('menuitem', { name: /public link/i })).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// AC 4/5 — non-operator member: no `⋮` menu, but member copy-link present
// ---------------------------------------------------------------------------

test.describe('Operator ⋮ menu — non-operator member persona', () => {
    test('member sees NO operator menu but DOES see the copy-link affordance when share-enabled', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        const invitee = await getInviteeFixture();

        // Public-share-enabled lineup, with the fixture user invited so the
        // page resolves to an invitee (non-operator) persona.
        const lineupId = await setupLineupInPhase(adminToken, 'building', {
            publicShareEnabled: true,
        });
        await apiPost(adminToken, `/lineups/${lineupId}/invitees`, {
            userIds: [invitee.userId],
        });
        await awaitProcessing(adminToken);

        await loginInvitee(page, invitee.jwt);
        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
            timeout: 10_000,
        });
        // Hero must render so we know the page mounted as the member.
        await expect(
            page.getByRole('list', { name: 'Lineup progress' }).first(),
        ).toBeVisible({ timeout: 15_000 });

        // No operator `⋮` menu for a non-operator member.
        await expect(page.getByTestId('lineup-operator-menu-trigger')).toHaveCount(0);
        await expect(page.getByTestId('lineup-operator-menu')).toHaveCount(0);

        // Member-visible Copy-link affordance present (toggle stays operator-only).
        await expect(page.getByTestId('lineup-share-copy')).toBeVisible({
            timeout: 5_000,
        });
    });
});

// ---------------------------------------------------------------------------
// AC 6 — activity log collapsed by default
// ---------------------------------------------------------------------------

test.describe('Activity log — collapsed by default', () => {
    test('activity log renders collapsed (heading visible, entries hidden)', async ({
        page,
    }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        const lineupId = await setupLineupInPhase(adminToken, 'building');

        await page.goto(`/community-lineup/${lineupId}`);
        await expect(page.locator('body')).not.toHaveText(/something went wrong/i, {
            timeout: 10_000,
        });

        // The collapsed accordion shows the heading button but no expanded
        // entry list. A freshly created lineup always has a "created" entry,
        // so the heading is present; the timeline entries must NOT be visible
        // until the operator expands it.
        const heading = page.getByTestId('activity-section-heading');
        await expect(heading).toBeVisible({ timeout: 15_000 });

        // Collapsed ⇒ no rendered timeline entries. The expanded body wraps
        // entries in the bordered panel; assert it's not shown by checking the
        // "created" timeline text is hidden.
        await expect(page.getByText(/created (this )?lineup/i)).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC 7 — public /p/lineup/:slug renders hero + composite, no operator menu
// ---------------------------------------------------------------------------

test.describe('Public lineup page — no operator chrome (AC 7)', () => {
    test('public page renders cleanly with no operator menu', async ({ browser }) => {
        test.setTimeout(HOOK_TIMEOUT_MS);
        await resetWorkerLineups(adminToken);
        const created = (await apiPost(adminToken, '/lineups', {
            title: lineupTitle,
            publicShareEnabled: true,
            // Explicit 'public' — CreateLineupSchema.visibility is
            // `.default('public').optional()`, which yields `undefined` (not
            // 'public') when omitted, and a private lineup can't be shared.
            visibility: 'public',
            buildingDurationHours: 720,
            votingDurationHours: 720,
            decidedDurationHours: 720,
        })) as { id?: number; publicSlug?: string };
        if (!created?.publicSlug) {
            throw new Error(
                `public lineup create missing publicSlug: ${JSON.stringify(created).slice(0, 200)}`,
            );
        }

        // Fresh, un-authed context — no admin JWT.
        const ctx = await browser.newContext({ storageState: undefined });
        const page = await ctx.newPage();
        await page.goto(`/p/lineup/${created.publicSlug}`);

        // Public title H1 renders (public page keeps its own H1 — the AC-3
        // header strip is the AUTHENTICATED detail page only).
        await expect(
            page.getByRole('heading', { level: 1, name: new RegExp(lineupTitle, 'i') }),
        ).toBeVisible({ timeout: 15_000 });

        // No operator `⋮` menu on the public page.
        await expect(page.getByTestId('lineup-operator-menu-trigger')).toHaveCount(0);
        await expect(page.getByTestId('lineup-operator-menu')).toHaveCount(0);

        await ctx.close();
    });
});
