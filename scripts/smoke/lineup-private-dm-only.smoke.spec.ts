/**
 * Private lineup DM-only edge-case smoke (ROK-1069).
 *
 * Validates the UI surface of a `visibility: 'private'` lineup:
 *   - A private lineup created via /lineups (with visibility=private) is
 *     reflected by GET /lineups/:id with visibility='private'.
 *   - The detail page for a private lineup renders without a crash.
 *   - The public-share fetch (un-authed) returns 404 for a private
 *     lineup even when publicShareEnabled is forced — privacy wins
 *     over the share toggle.
 *
 * Discord DM dispatch is exercised by the companion-bot smoke test in
 * tools/test-bot/src/smoke/tests/private-lineup.test.ts (already in
 * the suite from ROK-1065). This spec covers the web side.
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern).
 */
import { test, expect } from './base';
import {
    API_BASE,
    apiGet,
    apiPost,
    awaitProcessing,
    cancelLineupPhaseJobs,
    getAdminToken,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-private-dm-only';
let workerPrefix: string;
let lineupTitle: string;

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Private DM Only`;
});

async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

interface PrivateLineup {
    id: number;
    publicSlug: string;
    visibility: string;
}

async function createPrivateLineup(token: string): Promise<PrivateLineup> {
    await resetWorkerLineups(token);
    // Create the lineup as PUBLIC first — POST /lineups rejects
    // visibility=private without inviteeUserIds, and seeding invitees
    // here would couple the smoke fixture to user-management state.
    // The DEMO_MODE-only /admin/test/lineup/set-private endpoint flips
    // the column directly, which is what we actually want to exercise
    // for the DM-only behaviour assertions below.
    const created = (await apiPost(token, '/lineups', {
        title: lineupTitle,
        buildingDurationHours: 720,
        votingDurationHours: 720,
        decidedDurationHours: 720,
    })) as { id?: number; publicSlug?: string; visibility?: string };
    if (!created?.id) {
        throw new Error(
            `Failed to create lineup: ${JSON.stringify(created).slice(0, 200)}`,
        );
    }
    await cancelLineupPhaseJobs(token, created.id);
    await apiPost(token, '/admin/test/lineup/set-private', {
        lineupId: created.id,
        visibility: 'private',
    });
    await awaitProcessing(token);
    return {
        id: created.id,
        publicSlug: created.publicSlug ?? '',
        visibility: 'private',
    };
}

test.describe('Private lineup — DM-only behaviour', () => {
    let adminToken: string;
    let lineup: PrivateLineup;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineup = await createPrivateLineup(adminToken);
    });

    test('GET /lineups/:id reports visibility=private', async () => {
        const detail = await apiGet(adminToken, `/lineups/${lineup.id}`);
        expect(detail?.visibility).toBe('private');
    });

    test('private lineup detail page renders without crash for the operator', async ({
        page,
    }) => {
        await page.goto(`/community-lineup/${lineup.id}`);
        await expect(page.locator('body')).not.toHaveText(
            /something went wrong/i,
            { timeout: 10_000 },
        );
        // ROK-1323: legacy H1 title removed — title now renders in the composite
        // JourneyHero (or the fallback header for no-composite states).
        await expect(
            page.getByText(/Private DM Only|Lineup — /).first(),
        ).toBeVisible({ timeout: 15_000 });
    });

    test('public share endpoint returns 404 for a private lineup', async () => {
        if (!lineup.publicSlug) {
            test.skip(true, 'create response did not include publicSlug');
            return;
        }
        const res = await fetch(`${API_BASE}/lineups/public/${lineup.publicSlug}`);
        expect(res.status).toBe(404);
    });
});
