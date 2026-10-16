/**
 * ROK-1801 — `serverAwareGameCount` never counts Discord bots (ROK-1711 parity).
 */
import type { GuildMember } from 'discord.js';
import { serverAwareGameCount } from './voice-threshold-server-count.helpers';
import type { VoiceHandlerDeps } from './voice-handler-deps';
import type { ResolvedBinding } from './voice-state.helpers';
import {
  emptyServerRoster,
  type ServerRoster,
} from '../services/server-presence-roster.helpers';

const G = 10;

function member(id: string, bot: boolean): GuildMember {
  return { id, user: { id, bot } } as unknown as GuildMember;
}

function depsFor(
  members: GuildMember[],
  games: Record<string, number | null>,
  roster: ServerRoster | null,
): VoiceHandlerDeps {
  const channel = {
    isVoiceBased: () => true,
    members: new Map(members.map((m) => [m.id, m])),
  };
  const guild = { channels: { cache: new Map([['vc', channel]]) } };
  return {
    clientService: {
      getClient: () => ({ guilds: { cache: new Map([['g', guild]]) } }),
      getGuildId: () => 'g',
    },
    presenceDetector: {
      detectGameForMember: (m: GuildMember) =>
        Promise.resolve({ gameId: games[m.id] ?? null }),
    },
    serverRoster: roster ? { snapshot: () => Promise.resolve(roster) } : null,
  } as unknown as VoiceHandlerDeps;
}

const binding = { gameId: G } as ResolvedBinding;

describe('serverAwareGameCount — bots', () => {
  it('excludes a bot in voice from the game-bound tally', async () => {
    const deps = depsFor(
      [member('h1', false), member('bot', true)],
      { h1: G, bot: G },
      null,
    );
    await expect(serverAwareGameCount(deps, 'vc', binding)).resolves.toEqual({
      counted: 1,
      confirmedCount: 1,
      allConfirmed: true,
    });
  });

  it('a bot plus one server player stays at one human (no bot padding)', async () => {
    const roster = emptyServerRoster();
    roster.byGame.set(G, [
      {
        key: 'steam:s1',
        steamId: 's1',
        userId: null,
        discordUserId: null,
        name: null,
      },
    ]);
    roster.gameNames.set(G, 'g');
    const deps = depsFor([member('bot', true)], { bot: G }, roster);
    const tally = await serverAwareGameCount(deps, 'vc', binding);
    expect(tally.counted).toBe(1);
  });
});
