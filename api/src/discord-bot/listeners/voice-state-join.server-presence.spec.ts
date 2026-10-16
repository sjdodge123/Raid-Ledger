/**
 * ROK-1801 (Codex P2) — a general-lobby join resolves the member's game with
 * server presence winning over rich presence, matching the group merge (Q3).
 */
import type { GuildMember } from 'discord.js';
import { detectGameForLobby } from './voice-state-join.handlers';
import type { VoiceHandlerDeps } from './voice-handler-deps';
import type { ResolvedBinding } from './voice-state.helpers';
import { emptyServerRoster } from '../services/server-presence-roster.helpers';

const LOBBY = {
  bindingId: 'lobby',
  gameId: null,
  bindingPurpose: 'general-lobby',
  config: { minPlayers: 2 },
} as unknown as ResolvedBinding;

function depsWith(richGame: number | null, serverGame: number | null) {
  const roster = emptyServerRoster();
  if (serverGame !== null) {
    roster.byGame.set(serverGame, [
      {
        key: 'user:1',
        steamId: 's1',
        userId: 1,
        discordUserId: 'd1',
        name: 'Alice',
      },
    ]);
    roster.gameNames.set(serverGame, 'Valheim');
  }
  return {
    presenceDetector: {
      detectGameForMember: () =>
        Promise.resolve({ gameId: richGame, gameName: 'Rich Game' }),
    },
    serverRoster: { snapshot: () => Promise.resolve(roster) },
  } as unknown as VoiceHandlerDeps;
}

const gm = {
  id: 'd1',
  user: { id: 'd1', bot: false },
} as unknown as GuildMember;

describe('detectGameForLobby — server presence (ROK-1801)', () => {
  it('a member on a game server joins that game even when rich presence says another', async () => {
    const detected = await detectGameForLobby(
      depsWith(5, 10),
      LOBBY,
      { discordUserId: 'd1' },
      gm,
    );
    expect(detected).toEqual({ gameId: 10, gameName: 'Valheim' });
  });

  it('a presence-null member on a game server is still detected on that game', async () => {
    const detected = await detectGameForLobby(
      depsWith(null, 10),
      LOBBY,
      { discordUserId: 'd1' },
      gm,
    );
    expect(detected).toEqual({ gameId: 10, gameName: 'Valheim' });
  });

  it('no server presence → rich presence unchanged', async () => {
    const detected = await detectGameForLobby(
      depsWith(5, null),
      LOBBY,
      { discordUserId: 'd1' },
      gm,
    );
    expect(detected).toEqual({ gameId: 5, gameName: 'Rich Game' });
  });
});
