/**
 * CDP-based E2E slash command tests.
 *
 * These tests interact with Discord Electron via CDP (Chrome DevTools Protocol)
 * to validate that slash commands render correctly in the Discord UI.
 *
 * Gated behind DISCORD_CDP=true environment variable.
 * Requires Discord launched with: ./scripts/launch-discord.sh
 */
import type { SmokeTest, TestContext } from '../types.js';
import { SMOKE } from '../config.js';

// ---------------------------------------------------------------------------
// Gate — only run when DISCORD_CDP=true
// ---------------------------------------------------------------------------

function buildCdpTests(): SmokeTest[] {
  if (!process.env.DISCORD_CDP) return [];

  /** Shared CDP page — connect once, navigate to channel, reuse. */
  let cachedPage: import('playwright').Page | null = null;

  async function getPage(ctx: TestContext): Promise<import('playwright').Page> {
    if (cachedPage) return cachedPage;
    const { connectDiscordCDP, navigateToChannel, dismissEphemeralMessages } =
      await import('../cdp/discord-page.js');
    const { page } = await connectDiscordCDP();
    const p = page as import('playwright').Page;
    await navigateToChannel(p, SMOKE.guildId, ctx.defaultChannelId);
    // Wait for channel to fully settle before first command
    await p.waitForTimeout(2000);
    // Clear any leftover ephemeral messages from previous runs
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
    // Dismiss the ephemeral message to keep the chat clean for the next test
    await dismissEphemeralMessages(p);
  }

  const tests: SmokeTest[] = [
    {
      name: 'CDP: /help renders in Discord',
      category: 'cdp-command',
      async run(ctx) {
        await runCommand(ctx, 'help', '/help');
      },
    },
    {
      name: 'CDP: /events renders in Discord',
      category: 'cdp-command',
      async run(ctx) {
        await runCommand(ctx, 'events', '/events');
      },
    },
    {
      name: 'CDP: /bindings renders in Discord',
      category: 'cdp-command',
      async run(ctx) {
        await runCommand(ctx, 'bindings', '/bindings');
      },
    },
    {
      name: 'CDP: /playing renders in Discord',
      category: 'cdp-command',
      async run(ctx) {
        await runCommand(ctx, 'playing', '/playing');
      },
    },
    {
      name: 'CDP: /roster renders in Discord',
      category: 'cdp-command',
      async run(ctx) {
        await runCommand(ctx, 'roster', '/roster');
      },
    },
  ];

  return tests;
}

export const cdpSlashCommandTests = buildCdpTests();
