/**
 * Discord-bot preconditions for Playwright smoke specs.
 *
 * GitHub CI runs the smoke suite with NO connected Discord bot, so every
 * endpoint that reads the bot's guild answers empty, `null` or 503 there
 * (`GET /admin/discord/bindings` → `{ data: [] }`, `GET /discord/channels` →
 * 503, `GET /discord/members/list` → `[]`, …). A fleet env or a laptop with a
 * bot answers with real rows, so a spec that asserts those rows passes locally
 * and fails in every CI project (PR #1721, admin-discord-lifecycle).
 *
 * Two ways to write a spec that touches a bot-dependent endpoint:
 *
 * 1. PREFERRED — fixture the endpoint with `page.route`, so the spec runs (and
 *    asserts) everywhere, CI included. Route the exact endpoint, before
 *    `page.goto`:
 *
 *        const BINDINGS = /\/admin\/discord\/bindings$/;
 *        await page.route(BINDINGS, (route) =>
 *            route.fulfill({ json: { data: [FIXTURE_BINDING] } }));
 *
 *    Live examples: `admin-discord-join-post.smoke.spec.ts` (channels list),
 *    `admin-game-roles.smoke.spec.ts` (roles + game-role list).
 *
 * 2. When the spec genuinely needs the real guild, skip it where there is none:
 *
 *        test('…', async ({ page }) => {
 *            await requireDiscordBot(test, await getAdminToken(), 'asserts live binding rows');
 *            …
 *        });
 *
 *    It also works in `test.beforeAll` / `test.beforeEach`. The skip shows the
 *    reason in the report, so a CI "skipped" is never mistaken for a pass.
 *
 * 3. A test that opens a bot-gated page but asserts only bot-independent
 *    chrome declares it: `test.describe('…', { annotation: DISCORD_BOT_OPTIONAL }, …)`.
 *
 * On an env that SHOULD have a bot (a fleet slot), set
 * `SMOKE_REQUIRE_DISCORD_BOT=1`: "no bot" then FAILS the test instead of
 * skipping it. A failed status call always throws, and a bot still
 * `connecting` after boot is polled for up to 20s before deciding.
 *
 * `scripts/smoke-discord-bot-guard.spec.mjs` enforces one of these for every
 * entry in its BOT_GATED list. Background: TESTING.md → "Smoke specs and the Discord bot".
 */
import { apiGet, pollForCondition } from './api-helpers';

/** Bot status endpoint — answers on every env, `connected: false` without a bot. */
export const DISCORD_BOT_STATUS_PATH = '/admin/settings/discord-bot';

/** Env switch: `1` turns "no bot" into a failure (set it where a bot is expected). */
export const REQUIRE_DISCORD_BOT_ENV = 'SMOKE_REQUIRE_DISCORD_BOT';

/** How long a `connecting: true` bot gets to settle after an env boot. */
const CONNECTING_TIMEOUT_MS = 20_000;

/** Annotation for a test/describe that opens a bot-gated page but asserts only bot-independent chrome. */
export const DISCORD_BOT_OPTIONAL = {
    type: 'discord-bot-optional',
    description: 'Opens a bot-gated page but asserts only what renders without a bot (GitHub CI has none).',
} as const;

/** The skip-capable part of Playwright's `test` (structural, so `base.ts`'s extended `test` fits). */
export interface SkippableTest {
    skip(condition: boolean, description: string): void;
}

interface BotStatus {
    connected: boolean;
    connecting: boolean;
}

/** One status read. A failed call throws — a 401/500/renamed route must not read as "no bot". */
async function readBotStatus(token: string): Promise<BotStatus> {
    const status: unknown = await apiGet(token, DISCORD_BOT_STATUS_PATH);
    if (typeof status !== 'object' || status === null) {
        throw new Error(`GET ${DISCORD_BOT_STATUS_PATH} failed (non-2xx or empty body) — cannot tell whether the Discord bot is connected`);
    }
    return {
        connected: 'connected' in status && status.connected === true,
        connecting: 'connecting' in status && status.connecting === true,
    };
}

/** The bot's state once it stops `connecting` — or still connecting after CONNECTING_TIMEOUT_MS. */
async function settledBotStatus(token: string): Promise<BotStatus> {
    const first = await readBotStatus(token);
    if (!first.connecting) return first;
    let readFailed = false;
    try {
        return await pollForCondition(
            async () => {
                const status = await readBotStatus(token).catch((err: unknown) => {
                    readFailed = true;
                    throw err;
                });
                return status.connecting ? null : status;
            },
            { timeoutMs: CONNECTING_TIMEOUT_MS, intervalMs: 500, description: `${DISCORD_BOT_STATUS_PATH} connecting` },
        );
    } catch (err) {
        if (readFailed) throw err;
        return { connected: false, connecting: true };
    }
}

/** True only when the env's Discord bot reports itself connected (waits out a boot-time `connecting`). */
export async function discordBotConnected(token: string): Promise<boolean> {
    return (await settledBotStatus(token)).connected;
}

/**
 * Skip the current test (or hook's tests) when the bot is offline, naming why
 * the spec needs it — or FAIL when `SMOKE_REQUIRE_DISCORD_BOT=1`. Call before
 * any bot-dependent request or navigation.
 */
export async function requireDiscordBot(
    test: SkippableTest,
    token: string,
    reason: string,
): Promise<void> {
    const status = await settledBotStatus(token);
    if (!status.connected && process.env[REQUIRE_DISCORD_BOT_ENV] === '1') {
        const state = status.connecting ? `still connecting after ${CONNECTING_TIMEOUT_MS}ms` : 'not connected';
        throw new Error(`Discord bot expected (${REQUIRE_DISCORD_BOT_ENV}=1) but ${state}: ${reason}`);
    }
    test.skip(!status.connected, `Discord bot not connected (GitHub CI has none): ${reason}`);
}
