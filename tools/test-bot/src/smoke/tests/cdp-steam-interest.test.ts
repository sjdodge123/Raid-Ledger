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

  /** Get the logged-in Discord user's ID via CDP. */
  async function getLoggedInDiscordId(
    page: import('playwright').Page,
  ): Promise<string> {
    // Discord stores the current user in its webpack modules
    const discordId = await page.evaluate(() => {
      // Look for the user ID in the bottom-left user panel
      const el = document.querySelector('[class*="panelTitleContainer"]');
      // Fallback: extract from the avatar button's aria label or data
      const avatarBtn = document.querySelector(
        '[aria-label*="User Settings"], [class*="avatarWrapper"]',
      );
      const copyIdEl = avatarBtn?.closest('[data-user-id]');
      if (copyIdEl) {
        return copyIdEl.getAttribute('data-user-id') ?? '';
      }
      // Last resort: try to get it from Discord's internal store
      return (
        (window as Record<string, unknown>).__DISCORD_USER_ID__ ?? ''
      ).toString();
    });
    return discordId;
  }

  /** Set up: assign steamAppId to a game AND link the logged-in user. */
  async function setupFixtures(
    ctx: TestContext,
    page: import('playwright').Page,
  ): Promise<{ gameName: string; discordId: string }> {
    const game = ctx.games[0];
    if (!game) throw new Error('No games in test context');

    // Set steamAppId on the game
    await ctx.api.post('/admin/test/set-steam-app-id', {
      gameId: game.id,
      steamAppId: TEST_STEAM_APP_ID,
    });

    // Get the logged-in user's Discord ID via CDP
    let discordId = await getLoggedInDiscordId(page);

    // If CDP extraction failed, try getting it from the account section
    if (!discordId) {
      // Navigate to user settings to find the ID
      discordId = await page.evaluate(() => {
        // Try the bottom bar which shows the username#discriminator
        const sections = document.querySelectorAll(
          '[class*="panelSubtextContainer"], [class*="usernameContainer"]',
        );
        for (const s of sections) {
          const text = s.textContent ?? '';
          const match = text.match(/(\d{17,20})/);
          if (match) return match[1];
        }
        return '';
      });
    }

    // If we still can't get it, use the admin user's Discord ID from DB
    if (!discordId) {
      // The admin user (ctx.testUserId) should already be linked
      // Just use the test bot's Discord ID which is already linked
      discordId = ctx.testBotDiscordId;
    }

    // Link the Discord ID to the admin user for this test
    await ctx.api.post('/admin/test/link-discord', {
      userId: ctx.testUserId,
      discordId,
      username: 'cdp-test-user',
    });

    return { gameName: game.name, discordId };
  }

  /** Read the last DM content from the Discord DM list via CDP. */
  async function readLastDm(
    page: import('playwright').Page,
    timeoutMs: number,
  ): Promise<string> {
    // Navigate to Discord home (DM list)
    await page.click('[aria-label="Direct Messages"]').catch(() =>
      page.click('a[href="/channels/@me"]').catch(() => {}),
    );
    await page.waitForTimeout(2000);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Look for any DM with an unread indicator or recent message
      const found = await page.evaluate(() => {
        // Find DM entries in the sidebar
        const links = Array.from(document.querySelectorAll('a[href*="/@me/"]'));
        for (const link of links) {
          // Check for unread badge or recent activity
          const badge = link.querySelector('[class*="numberBadge"]');
          if (badge) {
            (link as HTMLElement).click();
            return true;
          }
        }
        // Fallback: click the first DM entry
        if (links.length > 0) {
          (links[0] as HTMLElement).click();
          return true;
        }
        return false;
      });

      if (found) {
        await page.waitForTimeout(2000);
        // Read the last message content
        const lastMsg = await page.evaluate(() => {
          const msgs = document.querySelectorAll(
            '[id^="message-content-"], [class*="messageContent"]',
          );
          const last = msgs[msgs.length - 1];
          return last?.textContent?.trim() ?? '';
        });
        if (lastMsg) return lastMsg;
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
        const p = await getPage(ctx);
        const { gameName } = await setupFixtures(ctx, p);
        const { typeMessage, navigateToChannel } = await import(
          '../cdp/discord-page.js'
        );

        // Send the Steam URL in the channel
        const url = `https://store.steampowered.com/app/${TEST_STEAM_APP_ID}/`;
        await typeMessage(p, url);

        // Wait for bot to process and send DM
        await p.waitForTimeout(5000);

        // Check for DM
        const dmText = await readLastDm(p, 15_000);

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
