/**
 * Lineup channel-override edge-case smoke (ROK-1069).
 *
 * Validates the API surface of the per-lineup Discord channel override
 * (ROK-1064):
 *   1. Happy path — create a lineup with `channelOverrideId`; the value
 *      round-trips through GET /lineups/:id.
 *   2. Fallback on perm loss — set `channelOverrideId` to a known-bad
 *      snowflake via the test endpoint. Subsequent fetches still return
 *      the row (no 500) and lifecycle transitions still succeed; the
 *      bot would warn-and-fall-back at dispatch time (verified by the
 *      companion-bot Discord smoke).
 *
 * The actual Discord-side fallback (warn-once + post to bound channel)
 * is exercised by tools/test-bot/src/smoke/tests/lineup-channel-override.test.ts.
 *
 * Per-worker title-prefix isolation (ROK-1147 pattern).
 */
import { test, expect } from './base';
import {
    apiGet,
    apiPatch,
    apiPost,
    awaitProcessing,
    cancelLineupPhaseJobs,
    getAdminToken,
} from './api-helpers';

test.describe.configure({ mode: 'serial' });

const FILE_PREFIX = 'lineup-channel-override';
let workerPrefix: string;
let lineupTitle: string;

// Bot-channel snowflakes are 17–20 digits. `999999999999999999` is a
// syntactically valid id that the bot will never have in its cache, so
// the resolver's `hasPostPermissions` check returns false and the
// fallback path fires.
const BAD_CHANNEL_ID = '999999999999999999';
// A different 18-digit fake id — used for the happy-path round-trip
// where we just verify the value persists through GET /lineups/:id.
const HAPPY_CHANNEL_ID = '123456789012345678';

test.beforeAll(({}, testInfo) => {
    workerPrefix = `smoke-w${testInfo.workerIndex}-${FILE_PREFIX}-`;
    lineupTitle = `${workerPrefix}Channel Override`;
});

async function resetWorkerLineups(token: string): Promise<void> {
    await apiPost(token, '/admin/test/reset-lineups', {
        titlePrefix: workerPrefix,
    });
}

async function createLineupWithOverride(token: string): Promise<number> {
    await resetWorkerLineups(token);
    const created = (await apiPost(token, '/lineups', {
        title: lineupTitle,
        channelOverrideId: HAPPY_CHANNEL_ID,
        buildingDurationHours: 720,
        votingDurationHours: 720,
        decidedDurationHours: 720,
    })) as { id?: number };
    if (!created?.id) {
        throw new Error(
            `Failed to create lineup with override: ${JSON.stringify(created).slice(0, 200)}`,
        );
    }
    await cancelLineupPhaseJobs(token, created.id);
    return created.id;
}

test.describe('Lineup channel-override edge case', () => {
    let adminToken: string;
    let lineupId: number;

    test.beforeAll(async () => {
        adminToken = await getAdminToken();
        lineupId = await createLineupWithOverride(adminToken);
    });

    test('happy path — channelOverrideId round-trips through GET /lineups/:id', async () => {
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(detail?.channelOverrideId).toBe(HAPPY_CHANNEL_ID);
    });

    test('fallback path — overriding to an inaccessible channel does not break reads or transitions', async () => {
        // Force the override to a channel the bot cannot post to.
        await apiPost(adminToken, '/admin/test/lineup/revoke-channel-perms', {
            lineupId,
            channelOverrideId: BAD_CHANNEL_ID,
        });
        await awaitProcessing(adminToken);

        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(detail?.channelOverrideId).toBe(BAD_CHANNEL_ID);

        // A lifecycle transition still succeeds — fallback is a notification
        // concern, not a control-plane concern. (Use direct PATCH; sibling
        // workers do not race because we filter to building→voting on this
        // worker's lineup id only.)
        const advanced = await apiPatch(
            adminToken,
            `/lineups/${lineupId}/status`,
            { status: 'voting' },
        );
        expect(advanced).toBeTruthy();
        await awaitProcessing(adminToken);

        const after = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(after?.status).toBe('voting');
    });

    test('clearing the override returns null on subsequent reads', async () => {
        await apiPost(adminToken, '/admin/test/lineup/revoke-channel-perms', {
            lineupId,
            channelOverrideId: null,
        });
        const detail = await apiGet(adminToken, `/lineups/${lineupId}`);
        expect(detail?.channelOverrideId).toBeNull();
    });
});
