/**
 * ROK-1454 D3 — where an LFM message gets posted.
 *
 * D3 deleted the round-1 `DISCORD_BOT_LFM_CHANNEL` setting: channel
 * configuration belongs to ROK-1471. What is left is the same
 * binding → default order `ChannelResolverService.resolveChannelForEvent`
 * already uses, plus a floor that WARNS and skips rather than throwing —
 * an unroutable LFM message must never take down the emitter.
 */
import { resolveLfmChannel, type LfmChannelDeps } from './lfm-channel.helpers';

const GAME_ID = 42;

function makeDeps(overrides: {
  guildId?: string | null;
  boundChannel?: string | null;
  defaultChannel?: string | null;
}): LfmChannelDeps & {
  warn: jest.Mock;
  getChannelForGame: jest.Mock;
  getDefault: jest.Mock;
} {
  const warn = jest.fn();
  const getChannelForGame = jest
    .fn<Promise<string | null>, [string, number]>()
    .mockResolvedValue(overrides.boundChannel ?? null);
  const getDefault = jest
    .fn<Promise<string | null>, []>()
    .mockResolvedValue(overrides.defaultChannel ?? null);
  const deps: LfmChannelDeps = {
    clientService: {
      getGuildId: () =>
        overrides.guildId === undefined ? 'guild-1' : overrides.guildId,
    },
    channelBindings: { getChannelForGame },
    settingsService: { getDiscordBotDefaultChannel: getDefault },
    logger: { warn },
  };
  return Object.assign(deps, { warn, getChannelForGame, getDefault });
}

describe('resolveLfmChannel (ROK-1454 D3)', () => {
  it("prefers the game's own game-announcements binding", async () => {
    const deps = makeDeps({ boundChannel: 'chan-bound' });

    await expect(resolveLfmChannel(deps, GAME_ID)).resolves.toEqual({
      guildId: 'guild-1',
      channelId: 'chan-bound',
    });
    expect(deps.getChannelForGame).toHaveBeenCalledWith('guild-1', GAME_ID);
  });

  it('never consults the default channel once a binding answered', async () => {
    const deps = makeDeps({
      boundChannel: 'chan-bound',
      defaultChannel: 'chan-default',
    });

    await resolveLfmChannel(deps, GAME_ID);

    expect(deps.getDefault).not.toHaveBeenCalled();
  });

  it('falls back to the bot default channel when the game is unbound', async () => {
    const deps = makeDeps({ boundChannel: null, defaultChannel: 'chan-def' });

    await expect(resolveLfmChannel(deps, GAME_ID)).resolves.toEqual({
      guildId: 'guild-1',
      channelId: 'chan-def',
    });
  });

  it('warns and skips — never throws — when nothing is configured', async () => {
    const deps = makeDeps({ boundChannel: null, defaultChannel: null });

    await expect(resolveLfmChannel(deps, GAME_ID)).resolves.toBeNull();
    expect(deps.warn).toHaveBeenCalledTimes(1);
    expect(deps.warn.mock.calls[0][0]).toContain('No Discord channel');
  });

  it('skips without a guild: the row it feeds needs a guild_id', async () => {
    const deps = makeDeps({ guildId: null, defaultChannel: 'chan-def' });

    await expect(resolveLfmChannel(deps, GAME_ID)).resolves.toBeNull();
    expect(deps.getChannelForGame).not.toHaveBeenCalled();
    expect(deps.warn.mock.calls[0][0]).toContain('no guild');
  });
});
