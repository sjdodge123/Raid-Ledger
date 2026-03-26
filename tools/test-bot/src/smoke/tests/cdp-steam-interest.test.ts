/**
 * CDP-based E2E test for Steam URL interest prompt (ROK-966).
 *
 * Posts a Steam store URL as the logged-in Discord user and verifies
 * the bot responds with an ephemeral interest prompt.
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

  const tests: SmokeTest[] = [
    {
      name: 'CDP: Steam URL triggers ephemeral interest prompt',
      category: 'cdp-command',
      async run(ctx) {
        const { gameName } = await setupSteamGame(ctx);
        const p = await getPage(ctx);
        const { typeMessage, readEphemeralResponse, dismissEphemeralMessages } =
          await import('../cdp/discord-page.js');

        const url = `https://store.steampowered.com/app/${TEST_STEAM_APP_ID}/`;
        const { prevEphemeralCount } = await typeMessage(p, url);
        const response = await readEphemeralResponse(
          p,
          15_000,
          prevEphemeralCount,
        );

        if (!response.content) {
          throw new Error(
            `Expected ephemeral prompt for "${gameName}", got no content`,
          );
        }

        // The ephemeral should mention the game name or "Interested"
        const lc = response.content.toLowerCase();
        const hasGameRef =
          lc.includes(gameName.toLowerCase()) || lc.includes('interested');
        if (!hasGameRef) {
          throw new Error(
            `Ephemeral content "${response.content}" doesn't reference game "${gameName}" or interest prompt`,
          );
        }

        await dismissEphemeralMessages(p);
      },
    },
  ];

  return tests;
}

export const cdpSteamInterestTests = buildCdpSteamTests();
