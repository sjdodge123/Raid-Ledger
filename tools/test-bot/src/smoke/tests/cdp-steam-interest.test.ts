/**
 * CDP-based E2E test for Steam URL interest prompt (ROK-966).
 *
 * Posts a Steam store URL as the logged-in Discord user and verifies
 * the bot sends a DM with the interest prompt.
 *
 * Gated behind DISCORD_CDP=true environment variable.
 * Requires Discord launched with: ./scripts/launch-discord.sh
 */
import type { SmokeTest, TestContext } from '../types.js';
import { SMOKE } from '../config.js';

/** Arbitrary Steam app ID used as a fixture marker. */
const TEST_STEAM_APP_ID = 99901;

function buildCdpSteamTests(): SmokeTest[] {
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

  /** Set steamAppId on the first game via the test API. */
  async function setupSteamGame(ctx: TestContext): Promise<{
    gameId: number;
    gameName: string;
  }> {
    const game = ctx.games[0];
    if (!game) throw new Error('No games in test context');
    await ctx.api.post('/admin/test/set-steam-app-id', {
      gameId: game.id,
      steamAppId: TEST_STEAM_APP_ID,
    });
    return { gameId: game.id, gameName: game.name };
  }

  /** Read the last DM content from the Discord DM list via CDP. */
  async function readLastDm(
    page: import('playwright').Page,
    botName: string,
    timeoutMs: number,
  ): Promise<string> {
    // Navigate to Discord home (DM list)
    await page.click('[aria-label="Direct Messages"]').catch(() => {
      // Fallback: click the Discord logo at top-left
      return page.click('a[href="/channels/@me"]').catch(() => {});
    });
    await page.waitForTimeout(2000);

    // Look for a DM from the bot in the sidebar
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Check for unread DM entries — bot name appears in the DM list
      const dmContent = await page.evaluate((name: string) => {
        // Find DM list items that contain the bot's name
        const items = Array.from(
          document.querySelectorAll('[class*="channel_"]'),
        );
        for (const item of items) {
          if (item.textContent?.includes(name)) {
            item.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            return 'found';
          }
        }
        return '';
      }, botName);

      if (dmContent === 'found') {
        await page.waitForTimeout(2000);
        // Read the last message in the DM channel
        const lastMsg = await page.evaluate(() => {
          const messages = document.querySelectorAll(
            '[id^="message-content-"], [class*="messageContent"]',
          );
          const last = messages[messages.length - 1];
          return last?.textContent?.trim() ?? '';
        });
        return lastMsg;
      }
      await page.waitForTimeout(1000);
    }
    return '';
  }

  const tests: SmokeTest[] = [
    {
      name: 'CDP: Steam URL triggers DM interest prompt',
      category: 'cdp-command',
      async run(ctx) {
        const { gameName } = await setupSteamGame(ctx);
        const p = await getPage(ctx);
        const { typeMessage, navigateToChannel } = await import(
          '../cdp/discord-page.js'
        );

        // Send the Steam URL in the channel
        const url = `https://store.steampowered.com/app/${TEST_STEAM_APP_ID}/`;
        await typeMessage(p, url);

        // Wait for bot to process and send DM
        await p.waitForTimeout(3000);

        // Check for DM from the bot
        const botName = SMOKE.botDisplayName ?? 'Raid Ledger';
        const dmText = await readLastDm(p, botName, 15_000);

        if (!dmText) {
          throw new Error(
            `Expected DM prompt for "${gameName}", got no DM from bot`,
          );
        }

        const lc = dmText.toLowerCase();
        const hasGameRef =
          lc.includes(gameName.toLowerCase()) || lc.includes('interested');
        if (!hasGameRef) {
          throw new Error(
            `DM content "${dmText}" doesn't reference game "${gameName}" or interest prompt`,
          );
        }

        // Navigate back to the test channel for subsequent tests
        await navigateToChannel(p, SMOKE.guildId, ctx.defaultChannelId);
        await p.waitForTimeout(1000);
      },
    },
  ];

  return tests;
}

export const cdpSteamInterestTests = buildCdpSteamTests();
