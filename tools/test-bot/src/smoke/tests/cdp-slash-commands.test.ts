/**
 * CDP-based E2E slash command tests.
 *
 * These tests interact with Discord Electron via CDP (Chrome DevTools Protocol)
 * to validate that slash commands render correctly in the Discord UI.
 *
 * Gated behind DISCORD_CDP=true environment variable.
 * Requires Discord launched with: ./scripts/launch-discord.sh
 */
import type { SmokeTest } from '../types.js';

// ---------------------------------------------------------------------------
// Gate — only run when DISCORD_CDP=true
// ---------------------------------------------------------------------------

function buildCdpTests(): SmokeTest[] {
  if (!process.env.DISCORD_CDP) return [];

  // Dynamic imports since playwright is not a direct dependency
  const tests: SmokeTest[] = [
    // Test 1: /help renders an embed in Discord UI
    {
      name: 'CDP: /help renders embed in Discord',
      category: 'cdp-command',
      async run() {
        const { connectDiscordCDP, typeSlashCommand, readEphemeralResponse } =
          await import('../cdp/discord-page.js');
        const { page } = await connectDiscordCDP();
        const p = page as import('playwright').Page;
        await typeSlashCommand(p, 'help');
        const response = await readEphemeralResponse(p, 15_000);
        if (!response.hasEmbed) {
          throw new Error(
            'CDP /help: expected embed in Discord UI, none found',
          );
        }
      },
    },

    // Test 2: /events renders in Discord UI
    {
      name: 'CDP: /events renders response in Discord',
      category: 'cdp-command',
      async run() {
        const { connectDiscordCDP, typeSlashCommand, readEphemeralResponse } =
          await import('../cdp/discord-page.js');
        const { page } = await connectDiscordCDP();
        const p = page as import('playwright').Page;
        await typeSlashCommand(p, 'events');
        const response = await readEphemeralResponse(p, 15_000);
        if (!response.content && !response.hasEmbed) {
          throw new Error(
            'CDP /events: expected content or embed, got nothing',
          );
        }
      },
    },

    // Test 3: /event create renders confirmation
    {
      name: 'CDP: /event create renders confirmation',
      category: 'cdp-command',
      async run() {
        const { connectDiscordCDP, typeSlashCommand, readEphemeralResponse } =
          await import('../cdp/discord-page.js');
        const { page } = await connectDiscordCDP();
        const p = page as import('playwright').Page;
        await typeSlashCommand(p, 'event create');
        const response = await readEphemeralResponse(p, 15_000);
        if (!response.content && !response.hasEmbed) {
          throw new Error(
            'CDP /event create: expected response, got nothing',
          );
        }
      },
    },

    // Test 4: /bind renders response
    {
      name: 'CDP: /bind renders response in Discord',
      category: 'cdp-command',
      async run() {
        const { connectDiscordCDP, typeSlashCommand, readEphemeralResponse } =
          await import('../cdp/discord-page.js');
        const { page } = await connectDiscordCDP();
        const p = page as import('playwright').Page;
        await typeSlashCommand(p, 'bind');
        const response = await readEphemeralResponse(p, 15_000);
        if (!response.content && !response.hasEmbed) {
          throw new Error(
            'CDP /bind: expected response, got nothing',
          );
        }
      },
    },

    // Test 5: /playing renders response
    {
      name: 'CDP: /playing renders response in Discord',
      category: 'cdp-command',
      async run() {
        const { connectDiscordCDP, typeSlashCommand, readEphemeralResponse } =
          await import('../cdp/discord-page.js');
        const { page } = await connectDiscordCDP();
        const p = page as import('playwright').Page;
        await typeSlashCommand(p, 'playing');
        const response = await readEphemeralResponse(p, 15_000);
        if (!response.content && !response.hasEmbed) {
          throw new Error(
            'CDP /playing: expected response, got nothing',
          );
        }
      },
    },
  ];

  return tests;
}

export const cdpSlashCommandTests = buildCdpTests();
