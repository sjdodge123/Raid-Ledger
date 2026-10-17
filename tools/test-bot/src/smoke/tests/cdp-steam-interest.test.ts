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

  /**
   * Get the logged-in Discord user's ID by intercepting network traffic.
   * Reloads the Discord page to trigger API calls with the auth token,
   * then calls Discord's /users/@me to get the user ID.
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

    // Read the real game name from the DB — ctx.games[0].name is a synthetic
    // `Game <id>` label (see setup.ts#buildDemoData). The listener reads the
    // true name from Postgres so assertions must use the DB value.
    const dbGame = await ctx.api.post<{ id: number; name: string }>(
      '/admin/test/get-game',
      { id: game.id },
    );
    const gameName = dbGame.name;

    // Get the logged-in user's Discord ID via CDP
    const discordId = await getLoggedInDiscordId(page);
    if (!discordId) {
      throw new Error(
        'Could not extract Discord user ID from CDP. Is Discord logged in?',
      );
    }

    // Link the Discord ID to the admin user for this test
    await ctx.api.post('/admin/test/link-discord', {
      userId: ctx.testUserId,
      discordId,
      username: 'cdp-test-user',
    });

    // Clear any existing interest from prior test runs
    await ctx.api.post('/admin/test/clear-game-interest', {
      userId: ctx.testUserId,
      gameId: game.id,
    });

    // Reset auto-heart preference so tests start from a known-clean baseline.
    // A prior run (e.g. the AC2 auto-heart test) can otherwise leave
    // autoHeartSteamUrls=true and make the interest-prompt test hit the
    // auto-heart branch instead.
    await ctx.api.post('/admin/test/set-auto-heart-pref', {
      userId: ctx.testUserId,
      enabled: false,
    });

    // ROK-1081: the listener now offers a nomination DM when a building
    // Community Lineup is active. These heart-flow tests assert the
    // unchanged ROK-966 copy, so make a best-effort attempt to archive
    // any active building lineup. The endpoint may 404 if no lineup exists
    // or if the test-only endpoint has not yet been deployed.
    try {
      await ctx.api.post('/admin/test/archive-active-lineup', {});
    } catch {
      // Endpoint is new (ROK-1081) and may not exist in older deployments.
      // Ignore — the test will still catch heart-flow regressions when
      // no lineup is present, which is the common case.
    }

    return { gameName, discordId };
  }

  /** Navigate to DMs and read the most recent DM message. */
  async function readLastDm(
    page: import('playwright').Page,
    timeoutMs: number,
  ): Promise<string> {
    // Click the Discord home button (logo with DM badge, top-left)
    await page.evaluate(() => {
      window.location.href = 'https://discord.com/channels/@me';
    });
    await page.waitForTimeout(3000);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Click the first DM in the list (most recent)
      const clicked = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const dmLink = links.find(
          (a) =>
            a.href?.includes('/@me/') && !a.href?.endsWith('/@me'),
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

  /**
   * Post a Steam URL in the test channel after ensuring the page is on the
   * correct channel and any ephemeral messages are dismissed.
   */
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
    // Give the bot time to process the message and dispatch a DM.
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
      name: 'CDP: Steam URL triggers DM interest prompt',
      category: 'cdp-command',
      async run(ctx) {
        const p = await getPage(ctx);
        const { gameName } = await setupFixtures(ctx, p);
        await postSteamUrl(ctx, p);

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

        await returnToTestChannel(ctx, p);
      },
    },
    {
      name: 'CDP: Steam URL on already-hearted game triggers "already hearted" DM',
      category: 'cdp-command',
      async run(ctx) {
        const p = await getPage(ctx);
        const { gameName } = await setupFixtures(ctx, p);

        // Pre-heart the game so the listener takes the "already hearted" path.
        const game = ctx.games[0];
        if (!game) throw new Error('No games in test context');
        await ctx.api.post('/admin/test/add-game-interest', {
          userId: ctx.testUserId,
          gameId: game.id,
        });

        await postSteamUrl(ctx, p);

        const dmText = await readLastDm(p, 15_000);

        if (!dmText) {
          throw new Error(
            `Expected "already hearted" DM for "${gameName}", got no DM from bot`,
          );
        }

        const lc = dmText.toLowerCase();
        const hasGameName = lc.includes(gameName.toLowerCase());
        const hasAlreadyPhrase = lc.includes('already have');
        if (!hasGameName || !hasAlreadyPhrase) {
          throw new Error(
            `DM content "${dmText}" missing expected markers ` +
              `(gameName=${hasGameName}, alreadyHavePhrase=${hasAlreadyPhrase}) ` +
              `for game "${gameName}"`,
          );
        }

        await returnToTestChannel(ctx, p);
      },
    },
    {
      name: 'CDP: Steam URL with auto-heart enabled triggers "auto-hearted" DM',
      category: 'cdp-command',
      async run(ctx) {
        const p = await getPage(ctx);
        const { gameName } = await setupFixtures(ctx, p);

        // Enable auto-heart preference so the listener hearts silently + DMs.
        await ctx.api.post('/admin/test/set-auto-heart-pref', {
          userId: ctx.testUserId,
          enabled: true,
        });

        try {
          await postSteamUrl(ctx, p);

          const dmText = await readLastDm(p, 15_000);

          if (!dmText) {
            throw new Error(
              `Expected "auto-hearted" DM for "${gameName}", got no DM from bot`,
            );
          }

          const lc = dmText.toLowerCase();
          const hasGameName = lc.includes(gameName.toLowerCase());
          const hasAutoPhrase = lc.includes('auto-hearted');
          if (!hasGameName || !hasAutoPhrase) {
            throw new Error(
              `DM content "${dmText}" missing expected markers ` +
                `(gameName=${hasGameName}, autoHeartedPhrase=${hasAutoPhrase}) ` +
                `for game "${gameName}"`,
            );
          }
        } finally {
          // Always disable the preference so it doesn't leak into later tests.
          await ctx.api.post('/admin/test/set-auto-heart-pref', {
            userId: ctx.testUserId,
            enabled: false,
          });
          await returnToTestChannel(ctx, p);
        }
      },
    },
  ];

  return tests;
}

export const cdpSteamInterestTests = buildCdpSteamTests();
