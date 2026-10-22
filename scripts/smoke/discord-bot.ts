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
 * `scripts/smoke-discord-bot-guard.spec.mjs` enforces one of the two for every
 * endpoint in its list. Background: TESTING.md → "Smoke specs and the Discord bot".
 */
import { apiGet } from './api-helpers';

/** Bot status endpoint — answers on every env, `connected: false` without a bot. */
export const DISCORD_BOT_STATUS_PATH = '/admin/settings/discord-bot';

/** The skip-capable part of Playwright's `test` (structural, so `base.ts`'s extended `test` fits). */
export interface SkippableTest {
    skip(condition: boolean, description: string): void;
}

/** True only when the env's Discord bot reports itself connected to a guild. */
export async function discordBotConnected(token: string): Promise<boolean> {
    const status: unknown = await apiGet(token, DISCORD_BOT_STATUS_PATH);
    return (
        typeof status === 'object' &&
        status !== null &&
        'connected' in status &&
        status.connected === true
    );
}

/**
 * Skip the current test (or hook's tests) when the bot is offline, naming why
 * the spec needs it. Call before any bot-dependent request or navigation.
 */
export async function requireDiscordBot(
    test: SkippableTest,
    token: string,
    reason: string,
): Promise<void> {
    const connected = await discordBotConnected(token);
    test.skip(!connected, `Discord bot not connected (GitHub CI has none): ${reason}`);
}
