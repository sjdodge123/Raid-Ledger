/**
 * ROK-1428 Codex r11 P1 — an overflow category (`Games 2`, created when the
 * source hits 50 children) copies the source category's permission
 * overwrites, so a private Games / Archived category stays private.
 */
import { ChannelType, Collection, OverwriteType } from 'discord.js';
import { ensureCategory } from './channel-lifecycle.discord-ops';

jest.mock('../services/scheduled-event.helpers', () => ({
  timedDiscordCall: (_label: string, fn: () => unknown) => fn(),
}));

interface Fake {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  permissionOverwrites: { cache: Map<string, unknown> };
}

const PRIVATE = {
  id: 'guild-1',
  type: OverwriteType.Role,
  allow: { bitfield: 0n },
  deny: { bitfield: 1024n },
};

function makeGuild(games: Fake) {
  const cache = new Collection<string, Fake>([[games.id, games]]);
  for (let i = 0; i < 50; i += 1) {
    const kid = `kid-${i}`;
    cache.set(kid, {
      id: kid,
      name: kid,
      type: ChannelType.GuildText,
      parentId: games.id,
      permissionOverwrites: { cache: new Map() },
    });
  }
  const create = jest.fn((opts: { name: string }) =>
    Promise.resolve({ id: 'new-1', name: opts.name }),
  );
  return {
    channels: { cache, create, fetch: jest.fn() },
  };
}

describe('ensureCategory overflow keeps the source privacy (Codex r11 P1)', () => {
  it('creates "Games 2" with the full Games category overwrites', async () => {
    const games: Fake = {
      id: 'cat-games',
      name: 'Games',
      type: ChannelType.GuildCategory,
      parentId: null,
      permissionOverwrites: { cache: new Map([[PRIVATE.id, PRIVATE]]) },
    };
    const guild = makeGuild(games);
    const res = await ensureCategory(guild as never, {
      id: 'cat-games',
      name: 'Games',
      needsRoom: true,
    });
    expect(res).toEqual({ id: 'new-1', name: 'Games 2', created: true });
    expect(guild.channels.create).toHaveBeenCalledWith({
      name: 'Games 2',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: 'guild-1', type: OverwriteType.Role, allow: 0n, deny: 1024n },
      ],
    });
  });
});
