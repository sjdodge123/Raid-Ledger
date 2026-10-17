/**
 * CDP-based E2E slash command tests.
 *
 * These tests interact with Discord Electron via CDP (Chrome DevTools Protocol)
 * to validate that slash commands render correctly in the Discord UI.
 *
 * Gated behind DISCORD_CDP=true environment variable.
 * Requires Discord launched with: ./scripts/launch-discord.sh
 *
 * IMPORTANT: Only commands with ZERO options can be tested here.
 * Commands with options (even optional ones like /playing's game param)
 * open Discord's options form instead of submitting on Enter, which
 * leaves stuck state that corrupts subsequent tests. Commands with
 * required options (/roster, /bind, /event create) are tested via
 * the CI-safe test harness instead.
 */
import type { SmokeTest, TestContext } from '../types.js';
import { SMOKE } from '../config.js';

function buildCdpTests(): SmokeTest[] {
  if (!process.env.DISCORD_CDP) return [];

  let cachedPage: import('playwright').Page | null = null;

  async function getPage(ctx: TestContext): Promise<import('playwright').Page> {
    if (cachedPage) return cachedPage;
    const { connectDiscordCDP, navigateToChannel, dismissEphemeralMessages } =
      await import('../cdp/discord-page.js');
    const { page } = await connectDiscordCDP();
    const p = page as import('playwright').Page;
    await navigateToChannel(p, SMOKE.guildId, ctx.defaultChannelId);
    await p.waitForTimeout(2000);
    await dismissEphemeralMessages(p);
    await p.waitForTimeout(1000);
    cachedPage = p;
    return p;
  }

  async function runCommand(
    ctx: TestContext,
    commandName: string,
    label: string,
  ): Promise<void> {
    const p = await getPage(ctx);
    const { typeSlashCommand, readEphemeralResponse, dismissEphemeralMessages } =
      await import('../cdp/discord-page.js');
    const { prevEphemeralCount } = await typeSlashCommand(p, commandName);
    const response = await readEphemeralResponse(p, 15_000, prevEphemeralCount);
    if (!response.content && !response.hasEmbed) {
      throw new Error(
        `CDP ${label}: expected content or embed in Discord UI, got nothing`,
      );
    }
    await dismissEphemeralMessages(p);
  }

  // Only zero-option commands — these submit immediately on Enter.
  const tests: SmokeTest[] = [
    {
      name: 'CDP: /help renders in Discord',
      category: 'cdp-command',
      run: (ctx) => runCommand(ctx, 'help', '/help'),
    },
    {
      name: 'CDP: /events renders in Discord',
      category: 'cdp-command',
      run: (ctx) => runCommand(ctx, 'events', '/events'),
    },
    {
      name: 'CDP: /bindings renders in Discord',
      category: 'cdp-command',
      run: (ctx) => runCommand(ctx, 'bindings', '/bindings'),
    },
  ];

  return tests;
}

export const cdpSlashCommandTests = buildCdpTests();
