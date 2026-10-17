/**
 * CDP-based E2E test for Steam URL paste-to-nominate (ROK-1081).
 *
 * Seeds an active Community Lineup in `building` status, then posts a
 * Steam store URL as the logged-in Discord user and verifies the bot
 * sends a DM offering to nominate the game for the current lineup.
 *
 * Gated behind DISCORD_CDP=true environment variable.
 * Requires Discord launched with: ./scripts/launch-discord.sh
 *
 * These tests depend on new DEMO_MODE-only endpoints that do NOT exist yet:
 *   - POST /admin/test/create-building-lineup
 *   - POST /admin/test/nominate-game
 *   - POST /admin/test/archive-lineup
 * Tests MUST fail until the dev agent adds these endpoints.
 */
import type { SmokeTest, TestContext } from '../types.js';
import { SMOKE } from '../config.js';

/** Arbitrary Steam app ID used as a fixture marker for this suite. */
const TEST_STEAM_APP_ID = 99902;

function buildCdpSteamNominationTests(): SmokeTest[] {
  if (!process.env.DISCORD_CDP) return [];

  let cachedPage: import('playwright').Page | null = null;

  async function getPage(
    ctx: TestContext,
  ): Promise<import('playwright').Page> {
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

  /**
   * Intercept Discord's CDP traffic to extract the auth token, then query
   * /users/@me to get the logged-in user's Discord ID.
   */
  async function getLoggedInDiscordId(
    page: import('playwright').Page,
  ): Promise<string> {
    const cdpSession = await page.context().newCDPSession(page);
    await cdpSession.send('Network.enable');
    let token: string | null = null;
    cdpSession.on(
      'Network.requestWillBeSent',
      (ev: { request: { headers: Record<string, string> } }) => {
        const a = ev.request.headers['Authorization'];
        if (a && !token) token = a;
      },
    );
    await page.evaluate(() => window.location.reload());
    await page.waitForTimeout(5000);
    await cdpSession.detach();
    if (!token) return '';
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: token },
    });
    if (!res.ok) return '';
    const user = (await res.json()) as { id: string };
    return user.id;
  }

  /**
   * Set up: create a building lineup, assign steamAppId to a game, link the
   * logged-in user, and clear both auto-heart + auto-nominate preferences.
   */
  async function setupFixtures(
    ctx: TestContext,
    page: import('playwright').Page,
  ): Promise<{ gameName: string; discordId: string; lineupId: number }> {
    const game = ctx.games[0];
    if (!game) throw new Error('No games in test context');

    // Create a building lineup for the test user.
    const lineup = await ctx.api.post<{ id: number }>(
      '/admin/test/create-building-lineup',
      { createdByUserId: ctx.testUserId },
    );

    // Assign steamAppId on the game so the listener resolves it.
    await ctx.api.post('/admin/test/set-steam-app-id', {
      gameId: game.id,
      steamAppId: TEST_STEAM_APP_ID,
    });

    const dbGame = await ctx.api.post<{ id: number; name: string }>(
      '/admin/test/get-game',
      { id: game.id },
    );
    const gameName = dbGame.name;

    // Link Discord ID to the admin user.
    const discordId = await getLoggedInDiscordId(page);
    if (!discordId) {
      throw new Error(
        'Could not extract Discord user ID from CDP. Is Discord logged in?',
      );
    }
    await ctx.api.post('/admin/test/link-discord', {
      userId: ctx.testUserId,
      discordId,
      username: 'cdp-nominate-user',
    });

    // Clean baseline: no existing interest, both auto-prefs disabled.
    await ctx.api.post('/admin/test/clear-game-interest', {
      userId: ctx.testUserId,
      gameId: game.id,
    });
    await ctx.api.post('/admin/test/set-auto-heart-pref', {
      userId: ctx.testUserId,
      enabled: false,
    });
    await ctx.api.post('/admin/test/set-auto-nominate-pref', {
      userId: ctx.testUserId,
      enabled: false,
    });

    return { gameName, discordId, lineupId: lineup.id };
  }

  /** Best-effort cleanup: archive the lineup so later tests see no building lineup. */
  async function cleanupLineup(
    ctx: TestContext,
    lineupId: number,
  ): Promise<void> {
    try {
      await ctx.api.post('/admin/test/archive-lineup', { lineupId });
    } catch {
      // Ignore — endpoint may not exist yet, or lineup may already be gone.
    }
  }

  /** Navigate to DMs and read the most recent DM message. */
  async function readLastDm(
    page: import('playwright').Page,
    timeoutMs: number,
  ): Promise<string> {
    await page.evaluate(() => {
      window.location.href = 'https://discord.com/channels/@me';
    });
    await page.waitForTimeout(3000);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const dmLink = links.find(
          (a) => a.href?.includes('/@me/') && !a.href?.endsWith('/@me'),
        );
        if (dmLink) {
          dmLink.click();
          return true;
        }
        return false;
      });

      if (clicked) {
        await page.waitForTimeout(2000);
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

  /** Post a Steam URL in the default channel after ensuring the UI is ready. */
  async function postSteamUrl(
    ctx: TestContext,
    p: import('playwright').Page,
  ): Promise<void> {
    const { typeMessage, navigateToChannel, dismissEphemeralMessages } =
      await import('../cdp/discord-page.js');
    await navigateToChannel(p, SMOKE.guildId, ctx.defaultChannelId);
    await p.waitForTimeout(2000);
    await dismissEphemeralMessages(p);
    const url = `https://store.steampowered.com/app/${TEST_STEAM_APP_ID}/`;
    await typeMessage(p, url);
    await p.waitForTimeout(5000);
  }

  /** Return to the default test channel for subsequent tests. */
  async function returnToTestChannel(
    ctx: TestContext,
    p: import('playwright').Page,
  ): Promise<void> {
    const { navigateToChannel } = await import('../cdp/discord-page.js');
    await navigateToChannel(p, SMOKE.guildId, ctx.defaultChannelId);
    await p.waitForTimeout(1000);
  }

  const tests: SmokeTest[] = [
    {
      name: 'CDP: Steam URL with active building lineup triggers nomination DM',
      category: 'cdp-command',
      async run(ctx) {
        const p = await getPage(ctx);
        const fixtures = await setupFixtures(ctx, p);
        try {
          await postSteamUrl(ctx, p);

          const dmText = await readLastDm(p, 15_000);
          if (!dmText) {
            throw new Error(
              `Expected nomination DM for "${fixtures.gameName}", got no DM`,
            );
          }

          const lc = dmText.toLowerCase();
          const hasGameName = lc.includes(fixtures.gameName.toLowerCase());
          const hasLineupCopy = lc.includes('community lineup');
          if (!hasGameName || !hasLineupCopy) {
            throw new Error(
              `DM content "${dmText}" missing expected markers ` +
                `(gameName=${hasGameName}, communityLineupCopy=${hasLineupCopy}) ` +
                `for game "${fixtures.gameName}"`,
            );
          }
        } finally {
          await cleanupLineup(ctx, fixtures.lineupId);
          await returnToTestChannel(ctx, p);
        }
      },
    },
    {
      name: 'CDP: Steam URL on already-nominated game triggers "already nominated" DM',
      category: 'cdp-command',
      async run(ctx) {
        const p = await getPage(ctx);
        const fixtures = await setupFixtures(ctx, p);
        try {
          const game = ctx.games[0];
          if (!game) throw new Error('No games in test context');

          // Pre-nominate the game so the listener takes the already-nominated path.
          await ctx.api.post('/admin/test/nominate-game', {
            lineupId: fixtures.lineupId,
            gameId: game.id,
            userId: ctx.testUserId,
          });

          await postSteamUrl(ctx, p);

          const dmText = await readLastDm(p, 15_000);
          if (!dmText) {
            throw new Error(
              `Expected "already nominated" DM for "${fixtures.gameName}", got no DM`,
            );
          }

          const lc = dmText.toLowerCase();
          const hasGameName = lc.includes(fixtures.gameName.toLowerCase());
          const hasAlreadyNominated = lc.includes('already nominated');
          if (!hasGameName || !hasAlreadyNominated) {
            throw new Error(
              `DM content "${dmText}" missing expected markers ` +
                `(gameName=${hasGameName}, alreadyNominatedPhrase=${hasAlreadyNominated}) ` +
                `for game "${fixtures.gameName}"`,
            );
          }
        } finally {
          await cleanupLineup(ctx, fixtures.lineupId);
          await returnToTestChannel(ctx, p);
        }
      },
    },
  ];

  return tests;
}

export const cdpSteamNominationTests = buildCdpSteamNominationTests();
