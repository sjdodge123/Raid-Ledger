/**
 * ROK-1801 layer E — game-server presence on the general-lobby presence card.
 *
 * Drives the D12 seam (`setLobbyPresence`) with one voice member who is ALSO on
 * the game's server, one named player on the server but not in the channel, and
 * one unnamed (unlinked) server player. The render, post and persistence still
 * run for real against Discord. Asserts the three server markers:
 *   - voice member on the server        → `**Name** 🖥`
 *   - on the server, not in the channel → `**Name** 🖥 on server`
 *   - unnamed server player             → `+1 on server` (never a SteamID)
 * and that all three count toward the group (`◌ 3 playing`, ruling 3 / Q4).
 *
 * Lives beside `voice-activity.test.ts` (1441 lines) and reuses its lobby
 * fixtures. Its channels come from the smoke run's filtered pool (non-slot
 * channels unless `SMOKE_CHANNEL_SET` names one; ROK-1623 / shared-guild rules).
 */
import { setLobbyPresence, type LobbyPresenceMember } from "../fixtures.js";
import type { SimpleMessage } from "../../helpers/messages.js";
import type { SmokeTest } from "../types.js";
import {
  assertAuthor,
  assertContains,
  assertLacks,
  expectMessageState,
  openLobbyRoom,
  twoGames,
  withVoiceBinding,
} from "./voice-activity.test.js";

const SERVER = "\u{1F5A5}";
const VOICE_ON_SERVER = `**Ana** ${SERVER}`;
const SERVER_ONLY_NAMED = `**Ren** ${SERVER} on server`;
const ANONYMOUS = "+1 on server";

/** The one embed whose roster carries the server markers. */
function serverGroupEmbed(msg: SimpleMessage) {
  return msg.embeds.find((e) => (e.description ?? "").includes(ANONYMOUS));
}

/** Assert the game group renders every ROK-1801 server marker. */
function assertServerGroup(msg: SimpleMessage): void {
  const group = serverGroupEmbed(msg);
  if (!group) {
    const seen = msg.embeds.map((e) => `"${e.description ?? ""}"`).join(" | ");
    throw new Error(
      `Lobby server presence: expected a game-group embed containing ` +
        `"${ANONYMOUS}", got descriptions: ${seen}`,
    );
  }
  const desc = group.description ?? "";
  assertContains(desc, VOICE_ON_SERVER, "voice member on the server");
  assertContains(desc, SERVER_ONLY_NAMED, "named server-only player");
  assertContains(desc, ANONYMOUS, "anonymous server player");
  assertLacks(desc, `**Ana** ${SERVER} on server`, "voice member marker");
  assertLacks(desc, "<@", "server group roster");
  assertAuthor(group, /^◌ 3 playing$/, "server group author (voice ∪ server)");
}

const lobbyServerPresenceRenders: SmokeTest = {
  name: "Lobby presence card shows game-server players (ROK-1801)",
  category: "voice",
  async run(ctx) {
    const [gameId] = await twoGames(ctx);
    await withVoiceBinding(
      ctx,
      2,
      "general-lobby",
      undefined,
      async (vChId) => {
        const members: LobbyPresenceMember[] = [
          {
            discordUserId: "rok1801-a",
            displayName: "Ana",
            gameId,
            onServer: true,
          },
        ];
        const serverOnly = [
          { displayName: "Ren", gameId },
          { displayName: null, gameId },
        ];
        try {
          const target = await openLobbyRoom(ctx, vChId, members, serverOnly);
          const msg = await expectMessageState(
            ctx,
            target,
            (m) => serverGroupEmbed(m) !== undefined,
            "The lobby card must render a game group with server players",
            "posted",
          );
          assertServerGroup(msg);
        } finally {
          await setLobbyPresence(ctx.api, vChId, null);
        }
      },
      { minPlayers: 2 },
    );
  },
};

export const lobbyServerPresenceTests: SmokeTest[] = [
  lobbyServerPresenceRenders,
];
